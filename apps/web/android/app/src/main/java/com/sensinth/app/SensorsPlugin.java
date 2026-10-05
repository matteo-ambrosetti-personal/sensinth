package com.sensinth.app;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Environment sensors that browsers do not expose: ambient light, air
 * pressure, and (on the few phones that have them) temperature and humidity.
 * Each reading is sent to the web layer as a "reading" event.
 */
@CapacitorPlugin(name = "NativeSensors")
public class SensorsPlugin extends Plugin implements SensorEventListener {

    private static final int[] TYPES = {
        Sensor.TYPE_LIGHT,
        Sensor.TYPE_PRESSURE,
        Sensor.TYPE_AMBIENT_TEMPERATURE,
        Sensor.TYPE_RELATIVE_HUMIDITY,
    };
    private static final String[] NAMES = { "light", "pressure", "temperature", "humidity" };

    private SensorManager manager;
    private boolean running = false;

    @Override
    public void load() {
        manager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
    }

    @PluginMethod
    public void available(PluginCall call) {
        JSArray list = new JSArray();
        if (manager != null) {
            for (int i = 0; i < TYPES.length; i++) {
                if (manager.getDefaultSensor(TYPES[i]) != null) list.put(NAMES[i]);
            }
        }
        JSObject result = new JSObject();
        result.put("sensors", list);
        call.resolve(result);
    }

    @PluginMethod
    public void start(PluginCall call) {
        running = true;
        register();
        call.resolve();
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

    private void register() {
        if (manager == null) return;
        for (int type : TYPES) {
            Sensor sensor = manager.getDefaultSensor(type);
            if (sensor != null) manager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI);
        }
    }

    private void unregister() {
        if (manager != null) manager.unregisterListener(this);
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        for (int i = 0; i < TYPES.length; i++) {
            if (TYPES[i] == event.sensor.getType()) {
                JSObject data = new JSObject();
                data.put("sensor", NAMES[i]);
                data.put("value", (double) event.values[0]);
                notifyListeners("reading", data);
                return;
            }
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}
}
