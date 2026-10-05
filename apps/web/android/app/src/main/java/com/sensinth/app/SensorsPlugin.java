package com.sensinth.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.hardware.TriggerEvent;
import android.hardware.TriggerEventListener;
import android.media.AudioManager;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Every sensor the phone has that browsers hide, plus the phone's own signals.
 *
 * <p>Hardware: light, air pressure, temperature and humidity where present, proximity, the
 * magnetic field, steps, significant motion, a foldable's hinge, and the vendor's own sensors
 * (a Galaxy's hall sensor, light colour, …). Motion, rotation and orientation are left to the
 * browser's Motion source.
 *
 * <p>Signals polled once a second: battery temperature, voltage, current, power and charging,
 * thermal headroom, Wi-Fi signal, screen brightness and media volume.
 *
 * <p>{@code describe()} lists the channels; after {@code start()} the latest value of every
 * channel that changed is sent as one "readings" event every 50 ms.
 */
@CapacitorPlugin(
    name = "NativeSensors",
    permissions = { @Permission(strings = { Manifest.permission.ACTIVITY_RECOGNITION }, alias = "activity") }
)
public class SensorsPlugin extends Plugin implements SensorEventListener {

    private static final long BATCH_MS = 50;
    private static final long POLL_MS = 1000;
    /** Vendor sensors beyond this many are left out, so the list stays readable. */
    private static final int MAX_VENDOR = 12;
    private static final int TYPE_HINGE_ANGLE = 36;

    /** One channel as the web layer sees it. */
    private static final class Channel {
        final String id;
        final String kind;
        final String label;
        final String unit;
        final double lo;
        final double hi;
        final boolean adaptive;
        final double minSpan;
        final double rateHz;

        Channel(String id, String kind, String label, String unit, double lo, double hi, boolean adaptive, double minSpan, double rateHz) {
            this.id = id;
            this.kind = kind;
            this.label = label;
            this.unit = unit;
            this.lo = lo;
            this.hi = hi;
            this.adaptive = adaptive;
            this.minSpan = minSpan;
            this.rateHz = rateHz;
        }

        JSObject toJson() {
            JSObject o = new JSObject();
            o.put("id", id);
            o.put("kind", kind);
            o.put("label", label);
            if (unit != null) o.put("unit", unit);
            if (hi > lo) {
                JSArray range = new JSArray();
                range.put(Double.valueOf(lo));
                range.put(Double.valueOf(hi));
                o.put("range", range);
            }
            o.put("adaptive", adaptive);
            if (minSpan > 0) o.put("minSpan", minSpan);
            o.put("rateHz", rateHz);
            return o;
        }
    }

    /** Turns one hardware event into a value for its channel. */
    private interface Reader {
        double read(SensorEvent event);
    }

    private SensorManager manager;
    private final List<Channel> channels = new ArrayList<>();
    private final Map<Sensor, String> sensorChannel = new HashMap<>();
    private final Map<Sensor, Reader> readers = new HashMap<>();
    private final Map<String, Double> pending = new LinkedHashMap<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean described = false;
    private boolean running = false;

    private Sensor stepDetector;
    private Sensor stepCounter;
    private Sensor significantMotion;
    private final ArrayDeque<Long> stepTimes = new ArrayDeque<>();
    private float lastStepCount = -1;
    private long lastStepCountAt = 0;
    private double stepsPerMinute = 0;

    private boolean hasThermal = false;
    private boolean hasWifi = false;

    private final Runnable flush = new Runnable() {
        @Override
        public void run() {
            sendPending();
            if (running) handler.postDelayed(this, BATCH_MS);
        }
    };

    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            pollSignals();
            if (running) handler.postDelayed(this, POLL_MS);
        }
    };

    private final TriggerEventListener motionTrigger = new TriggerEventListener() {
        @Override
        public void onTrigger(TriggerEvent event) {
            put("native.motion", 1);
            // One-shot: back to rest after a second, then wait for the next start.
            handler.postDelayed(() -> put("native.motion", 0), 1000);
            if (running && manager != null && significantMotion != null) {
                manager.requestTriggerSensor(this, significantMotion);
            }
        }
    };

    @Override
    public void load() {
        manager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
    }

    @PluginMethod
    public void describe(PluginCall call) {
        build();
        JSArray list = new JSArray();
        for (Channel c : channels) list.put(c.toJson());
        JSObject result = new JSObject();
        result.put("channels", list);
        call.resolve(result);
    }

    @PluginMethod
    public void start(PluginCall call) {
        build();
        boolean wantsSteps = stepDetector != null || stepCounter != null;
        if (wantsSteps && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && getPermissionState("activity") != PermissionState.GRANTED) {
            requestPermissionForAlias("activity", call, "afterActivityPermission");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    private void afterActivityPermission(PluginCall call) {
        // Without the permission the step sensors stay silent; everything else still runs.
        begin(call);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        running = false;
        unregister();
        call.resolve();
    }

    @Override
    protected void handleOnPause() {
        unregister();
    }

    @Override
    protected void handleOnResume() {
        if (running) register();
    }

    @Override
    protected void handleOnDestroy() {
        running = false;
        unregister();
    }

    private void begin(PluginCall call) {
        running = true;
        register();
        call.resolve();
    }

    /** Lists the channels once: hardware sensors first, then the phone's own signals. */
    private void build() {
        if (described) return;
        described = true;
        if (manager != null) {
            addDefault(Sensor.TYPE_LIGHT, new Channel("native.light", "light", "Light", "lx", 0, 100000, true, 30, 5), e -> e.values[0]);
            addDefault(Sensor.TYPE_PRESSURE, new Channel("native.pressure", "pressure", "Air pressure", "hPa", 0, 0, true, 1.5, 5), e -> e.values[0]);
            addDefault(Sensor.TYPE_AMBIENT_TEMPERATURE, new Channel("native.temperature", "temperature", "Temperature", "°C", 0, 0, true, 2, 1), e -> e.values[0]);
            addDefault(Sensor.TYPE_RELATIVE_HUMIDITY, new Channel("native.humidity", "humidity", "Humidity", "%", 0, 100, false, 0, 1), e -> e.values[0]);
            Sensor proximity = manager.getDefaultSensor(Sensor.TYPE_PROXIMITY);
            if (proximity != null) {
                final float far = Math.max(0.001f, proximity.getMaximumRange());
                addSensor(proximity, new Channel("native.proximity", "proximity", "Something near", null, 0, 1, false, 0, 5), e -> 1 - Math.min(1, e.values[0] / far));
            }
            addDefault(Sensor.TYPE_MAGNETIC_FIELD, new Channel("native.magnetic", "magnetic.field", "Magnetic field", "µT", 0, 0, true, 5, 20), e -> Math.sqrt(e.values[0] * e.values[0] + e.values[1] * e.values[1] + e.values[2] * e.values[2]));
            addDefault(TYPE_HINGE_ANGLE, new Channel("native.hinge", "lid.angle", "Hinge angle", "°", 0, 180, false, 0, 10), e -> e.values[0]);

            stepDetector = nonWakeUp(Sensor.TYPE_STEP_DETECTOR);
            stepCounter = stepDetector == null ? nonWakeUp(Sensor.TYPE_STEP_COUNTER) : null;
            if (stepDetector != null || stepCounter != null) {
                channels.add(new Channel("native.steps", "steps.rate", "Walking pace", "steps/min", 0, 200, false, 0, 1));
            }
            significantMotion = manager.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION);
            if (significantMotion != null) {
                channels.add(new Channel("native.motion", "motion.event", "Started moving", null, 0, 1, false, 0, 1));
            }
            addVendorSensors();
        }

        channels.add(new Channel("native.batteryTemp", "battery.temperature", "Battery temperature", "°C", 0, 0, true, 2, 1));
        channels.add(new Channel("native.batteryVoltage", "battery.voltage", "Battery voltage", "V", 0, 0, true, 0.05, 1));
        channels.add(new Channel("native.batteryCurrent", "battery.current", "Battery current", "A", 0, 0, true, 0.2, 1));
        channels.add(new Channel("native.batteryPower", "battery.power", "Power draw", "W", 0, 0, true, 0.5, 1));
        channels.add(new Channel("native.charging", "charging", "Plugged in", null, 0, 1, false, 0, 1));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            hasThermal = true;
            channels.add(new Channel("native.thermal", "thermal", "Heat (thermal headroom)", null, 0, 1, false, 0, 1));
        }
        if (getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE) != null) {
            hasWifi = true;
            channels.add(new Channel("native.wifi", "wifi.rssi", "Wi-Fi signal", "dBm", -100, -30, false, 0, 1));
        }
        channels.add(new Channel("native.brightness", "screen.brightness", "Screen brightness", null, 0, 255, true, 20, 1));
        channels.add(new Channel("native.volume", "volume", "Media volume", null, 0, 1, false, 0, 1));
    }

    private Sensor nonWakeUp(int type) {
        Sensor s = manager.getDefaultSensor(type, false);
        return s != null ? s : manager.getDefaultSensor(type);
    }

    private void addDefault(int type, Channel channel, Reader reader) {
        Sensor sensor = nonWakeUp(type);
        if (sensor != null) addSensor(sensor, channel, reader);
    }

    private void addSensor(Sensor sensor, Channel channel, Reader reader) {
        channels.add(channel);
        sensorChannel.put(sensor, channel.id);
        readers.put(sensor, reader);
    }

    /**
     * The phone maker's own sensors (types from 65536 up): each becomes a channel of its first
     * value, named as the phone names it. A hall sensor counts as a cover.
     */
    private void addVendorSensors() {
        int added = 0;
        for (Sensor s : manager.getSensorList(Sensor.TYPE_ALL)) {
            if (added >= MAX_VENDOR) break;
            if (s.getType() < Sensor.TYPE_DEVICE_PRIVATE_BASE || s.isWakeUpSensor()) continue;
            int mode = s.getReportingMode();
            if (mode == Sensor.REPORTING_MODE_ONE_SHOT || mode == Sensor.REPORTING_MODE_SPECIAL_TRIGGER) continue;
            String name = s.getName() == null ? "Sensor" : s.getName().trim();
            String lower = name.toLowerCase(Locale.ROOT);
            if (lower.contains("uncalibrated") || lower.contains("wake")) continue;
            String kind = lower.contains("hall") ? "cover" : "android." + slug(s.getStringType(), s.getType());
            int delay = s.getMinDelay();
            double rate = delay > 0 ? Math.min(50, 1e6 / delay) : 5;
            String label = name.length() > 40 ? name.substring(0, 40) : name;
            addSensor(s, new Channel("native.v" + added, kind, label, null, 0, 0, true, 0, rate), e -> e.values.length > 0 ? e.values[0] : 0);
            added++;
        }
    }

    private static String slug(String type, int number) {
        if (type == null || type.isEmpty()) return "type" + number;
        String s = type.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9.]+", "_");
        return s.length() > 48 ? s.substring(s.length() - 48) : s;
    }

    private void register() {
        if (manager != null) {
            for (Sensor s : readers.keySet()) manager.registerListener(this, s, SensorManager.SENSOR_DELAY_UI);
            if (stepDetector != null) manager.registerListener(this, stepDetector, SensorManager.SENSOR_DELAY_NORMAL);
            if (stepCounter != null) manager.registerListener(this, stepCounter, SensorManager.SENSOR_DELAY_NORMAL);
            if (significantMotion != null) manager.requestTriggerSensor(motionTrigger, significantMotion);
        }
        handler.removeCallbacks(flush);
        handler.removeCallbacks(poll);
        handler.post(poll);
        handler.postDelayed(flush, BATCH_MS);
    }

    private void unregister() {
        if (manager != null) {
            manager.unregisterListener(this);
            if (significantMotion != null) manager.cancelTriggerSensor(motionTrigger, significantMotion);
        }
        handler.removeCallbacks(flush);
        handler.removeCallbacks(poll);
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        Sensor s = event.sensor;
        if (s == stepDetector) {
            stepTimes.add(System.currentTimeMillis());
            return;
        }
        if (s == stepCounter) {
            long now = System.currentTimeMillis();
            float count = event.values[0];
            if (lastStepCount >= 0 && now > lastStepCountAt) {
                double perMinute = (count - lastStepCount) * 60000.0 / (now - lastStepCountAt);
                stepsPerMinute = Math.max(0, Math.min(250, perMinute));
            }
            lastStepCount = count;
            lastStepCountAt = now;
            return;
        }
        String id = sensorChannel.get(s);
        Reader reader = readers.get(s);
        if (id != null && reader != null) put(id, reader.read(event));
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}

    private void put(String id, double value) {
        if (!Double.isNaN(value) && !Double.isInfinite(value)) pending.put(id, value);
    }

    private void sendPending() {
        if (pending.isEmpty()) return;
        JSArray rows = new JSArray();
        for (Map.Entry<String, Double> e : pending.entrySet()) {
            JSArray row = new JSArray();
            row.put(e.getKey());
            row.put(e.getValue());
            rows.put(row);
        }
        pending.clear();
        JSObject data = new JSObject();
        data.put("r", rows);
        notifyListeners("readings", data);
    }

    /** The phone's own signals, and the step rate. */
    private void pollSignals() {
        Context ctx = getContext();
        long now = System.currentTimeMillis();

        if (stepDetector != null) {
            while (!stepTimes.isEmpty() && now - stepTimes.peekFirst() > 10000) stepTimes.pollFirst();
            put("native.steps", stepTimes.size() * 6.0);
        } else if (stepCounter != null) {
            if (now - lastStepCountAt > 10000) stepsPerMinute = 0;
            put("native.steps", stepsPerMinute);
        }

        Intent battery = ctx.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        double volts = Double.NaN;
        if (battery != null) {
            int temp = battery.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Integer.MIN_VALUE);
            if (temp != Integer.MIN_VALUE) put("native.batteryTemp", temp / 10.0);
            int mv = battery.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1);
            if (mv > 0) {
                volts = mv > 100 ? mv / 1000.0 : mv;
                put("native.batteryVoltage", volts);
            }
            put("native.charging", battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0 ? 1 : 0);
        }
        BatteryManager bm = (BatteryManager) ctx.getSystemService(Context.BATTERY_SERVICE);
        if (bm != null) {
            int raw = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW);
            if (raw != Integer.MIN_VALUE && raw != 0) {
                // Microamps on most phones; some report milliamps.
                double amps = Math.abs(raw) < 10000 ? raw / 1000.0 : raw / 1e6;
                put("native.batteryCurrent", Math.abs(amps));
                if (!Double.isNaN(volts)) put("native.batteryPower", Math.abs(amps * volts));
            }
        }

        if (hasThermal) {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                double heat = Double.NaN;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    float headroom = pm.getThermalHeadroom(10);
                    if (!Float.isNaN(headroom)) heat = Math.min(1, Math.max(0, headroom));
                }
                if (Double.isNaN(heat) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    heat = Math.min(1, pm.getCurrentThermalStatus() / 4.0);
                }
                put("native.thermal", heat);
            }
        }

        if (hasWifi) {
            WifiManager wm = (WifiManager) ctx.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                @SuppressWarnings("deprecation")
                WifiInfo info = wm.getConnectionInfo();
                if (info != null && info.getRssi() > -127) put("native.wifi", info.getRssi());
            }
        }

        try {
            put("native.brightness", Settings.System.getInt(ctx.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS));
        } catch (Settings.SettingNotFoundException ignored) {
            // Some phones keep brightness elsewhere.
        }
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        if (am != null) {
            int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            if (max > 0) put("native.volume", am.getStreamVolume(AudioManager.STREAM_MUSIC) / (double) max);
        }
    }
}
