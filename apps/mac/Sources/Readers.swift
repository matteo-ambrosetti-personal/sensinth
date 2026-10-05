import CoreBluetooth
import CoreGraphics
import CoreWLAN
import Darwin
import Foundation
import IOKit
import IOKit.hid

/// Polls `read` on a background queue every `interval` seconds.
final class Poller {
    private var timer: DispatchSourceTimer?

    func start(every interval: Double, _ read: @escaping () -> Void) {
        let t = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
        t.schedule(deadline: .now(), repeating: interval)
        t.setEventHandler(handler: read)
        t.resume()
        timer = t
    }

    func stop() {
        timer?.cancel()
        timer = nil
    }
}

// MARK: - Lid angle

/**
 * The lid hinge sensor of recent MacBooks: Apple's sensor-hub HID device
 * 05ac:8104 (usage page 0x20, usage 0x8a). Feature report 1 holds the angle
 * in degrees. No special permission is needed to read it.
 */
final class LidReader: NativeReader {
    private var manager: IOHIDManager?
    private var device: IOHIDDevice?
    private let poller = Poller()
    private(set) var channels: [ChannelInfo] = []

    init() {
        let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
        let matching: [String: Any] = [
            kIOHIDVendorIDKey as String: 0x05AC,
            kIOHIDProductIDKey as String: 0x8104,
            kIOHIDPrimaryUsagePageKey as String: 0x20,
            kIOHIDPrimaryUsageKey as String: 0x8A,
        ]
        IOHIDManagerSetDeviceMatching(manager, matching as CFDictionary)
        IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeNone))
        if let set = IOHIDManagerCopyDevices(manager) {
            device = (set as NSSet).allObjects.first.map { $0 as! IOHIDDevice }
        }
        self.manager = manager
        if device != nil {
            channels = [
                ChannelInfo(
                    id: "mac.lid", kind: "lid.angle", label: "Lid angle", unit: "°",
                    range: (0, 180), minSpan: 20, rateHz: 30)
            ]
        }
    }

    func start(_ emit: @escaping (String, Double) -> Void) {
        guard let device else { return }
        IOHIDDeviceOpen(device, IOOptionBits(kIOHIDOptionsTypeNone))
        poller.start(every: 1.0 / 30) {
            var report = [UInt8](repeating: 0, count: 8)
            var length = CFIndex(report.count)
            let result = IOHIDDeviceGetReport(device, kIOHIDReportTypeFeature, 1, &report, &length)
            if result == 0 && length >= 3 {
                emit("mac.lid", Double(UInt16(report[1]) | UInt16(report[2]) << 8))
            }
        }
    }

    func stop() {
        poller.stop()
    }
}

// MARK: - Ambient light and temperatures (private HID event system)

private typealias ClientCreate = @convention(c) (CFAllocator?) -> OpaquePointer?
private typealias ClientSetMatching = @convention(c) (OpaquePointer, CFDictionary) -> Void
private typealias ClientCopyServices = @convention(c) (OpaquePointer) -> Unmanaged<CFArray>?
private typealias ServiceCopyProperty = @convention(c) (OpaquePointer, CFString) -> Unmanaged<CFTypeRef>?
private typealias ServiceCopyEvent = @convention(c) (OpaquePointer, Int64, Int32, Int64) -> OpaquePointer?
private typealias EventGetFloat = @convention(c) (OpaquePointer, Int32) -> Double

private func symbol<T>(_ name: String, as type: T.Type) -> T? {
    guard let pointer = dlsym(UnsafeMutableRawPointer(bitPattern: -2), name) else { return nil }
    return unsafeBitCast(pointer, to: type)
}

/// Apple Silicon sensors behind IOKit's private HID event system (no permission needed).
private struct HIDServices {
    let services: [OpaquePointer]
    let name: (OpaquePointer) -> String
    let read: (OpaquePointer, Int64) -> Double?

    init?(page: Int, usage: Int) {
        guard
            let create = symbol("IOHIDEventSystemClientCreate", as: ClientCreate.self),
            let setMatching = symbol("IOHIDEventSystemClientSetMatching", as: ClientSetMatching.self),
            let copyServices = symbol("IOHIDEventSystemClientCopyServices", as: ClientCopyServices.self),
            let copyProperty = symbol("IOHIDServiceClientCopyProperty", as: ServiceCopyProperty.self),
            let copyEvent = symbol("IOHIDServiceClientCopyEvent", as: ServiceCopyEvent.self),
            let getFloat = symbol("IOHIDEventGetFloatValue", as: EventGetFloat.self),
            let client = create(kCFAllocatorDefault)
        else { return nil }
        setMatching(client, ["PrimaryUsagePage": page, "PrimaryUsage": usage] as CFDictionary)
        guard let array = copyServices(client)?.takeRetainedValue() else { return nil }
        var found: [OpaquePointer] = []
        for i in 0..<CFArrayGetCount(array) {
            if let raw = CFArrayGetValueAtIndex(array, i) { found.append(OpaquePointer(raw)) }
        }
        guard !found.isEmpty else { return nil }
        // Keep the array (and with it the services) alive for the app's lifetime.
        _ = Unmanaged.passRetained(array)
        services = found
        name = { service in
            (copyProperty(service, "Product" as CFString)?.takeRetainedValue() as? String) ?? ""
        }
        read = { service, type in
            guard let event = copyEvent(service, type, 0, 0) else { return nil }
            let value = getFloat(event, Int32(type << 16))
            Unmanaged<AnyObject>.fromOpaque(UnsafeRawPointer(event)).release()
            return value
        }
    }
}

/**
 * Ambient light (lux) and chip temperatures, read through the HID event
 * system the way macOS's own tools do. Either may be missing.
 */
final class HIDEventReader: NativeReader {
    private static let temperatureEvent: Int64 = 15
    private static let lightEvent: Int64 = 12
    private let light = HIDServices(page: 0xFF00, usage: 4)
    private let temperatures = HIDServices(page: 0xFF00, usage: 5)
    private var dies: [OpaquePointer] = []
    private let poller = Poller()
    private(set) var channels: [ChannelInfo] = []

    init() {
        if light != nil {
            channels.append(
                ChannelInfo(
                    id: "mac.light", kind: "light", label: "Light", unit: "lx", range: (0, 10000),
                    minSpan: 30, rateHz: 2))
        }
        if let temperatures {
            // The processor dies, when the sensors say which they are; otherwise all of them.
            let named = temperatures.services.filter { temperatures.name($0).lowercased().contains("tdie") }
            dies = named.isEmpty ? temperatures.services : named
            channels.append(
                ChannelInfo(
                    id: "mac.chipTemp", kind: "temperature.device", label: "Chip temperature",
                    unit: "°C", minSpan: 3, rateHz: 1))
        }
    }

    func start(_ emit: @escaping (String, Double) -> Void) {
        poller.start(every: 0.5) { [weak self] in
            guard let self else { return }
            if let light = self.light, let service = light.services.first,
                let lux = light.read(service, Self.lightEvent)
            {
                emit("mac.light", lux)
            }
            if let temperatures = self.temperatures {
                let values = self.dies.compactMap { temperatures.read($0, Self.temperatureEvent) }
                    .filter { $0 > 0 && $0 < 150 }
                if let hottest = values.max() { emit("mac.chipTemp", hottest) }
            }
        }
    }

    func stop() {
        poller.stop()
    }
}

// MARK: - Battery

/// Battery level, temperature, power draw and charging, from the AppleSmartBattery service.
final class BatteryReader: NativeReader {
    private let service: io_service_t
    private let poller = Poller()
    private(set) var channels: [ChannelInfo] = []

    init() {
        service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("AppleSmartBattery"))
        if service != 0 {
            channels = [
                ChannelInfo(id: "mac.battery", kind: "battery", label: "Battery", unit: "%", range: (0, 100), adaptive: false, rateHz: 1),
                ChannelInfo(id: "mac.batteryTemp", kind: "battery.temperature", label: "Battery temperature", unit: "°C", minSpan: 2, rateHz: 1),
                ChannelInfo(id: "mac.batteryPower", kind: "battery.power", label: "Power draw", unit: "W", minSpan: 2, rateHz: 1),
                ChannelInfo(id: "mac.charging", kind: "charging", label: "Plugged in", range: (0, 1), adaptive: false, rateHz: 1),
            ]
        }
    }

    private func number(_ key: String) -> Int? {
        guard let value = IORegistryEntryCreateCFProperty(service, key as CFString, kCFAllocatorDefault, 0)?
            .takeRetainedValue() as? NSNumber
        else { return nil }
        return value.intValue
    }

    func start(_ emit: @escaping (String, Double) -> Void) {
        poller.start(every: 1) { [weak self] in
            guard let self else { return }
            if let current = self.number("CurrentCapacity"), let max = self.number("MaxCapacity"), max > 0 {
                // Apple Silicon reports a percentage; Intel Macs report mAh.
                emit("mac.battery", max == 100 ? Double(current) : Double(current) * 100 / Double(max))
            }
            if let temp = self.number("Temperature") { emit("mac.batteryTemp", Double(temp) / 100) }
            if let mv = self.number("Voltage"), let ma = self.number("InstantAmperage") ?? self.number("Amperage") {
                // Discharge comes as a negative number, sometimes stored unsigned.
                let amps = Double(Int32(truncatingIfNeeded: ma)) / 1000
                emit("mac.batteryPower", abs(Double(mv) / 1000 * amps))
            }
            if let plugged = IORegistryEntryCreateCFProperty(self.service, "ExternalConnected" as CFString, kCFAllocatorDefault, 0)?
                .takeRetainedValue() as? Bool
            {
                emit("mac.charging", plugged ? 1 : 0)
            }
        }
    }

    func stop() {
        poller.stop()
    }
}

// MARK: - The machine: heat, load, memory, input, network

/// Thermal state, CPU load, memory pressure, idle time and network traffic.
final class SystemReader: NativeReader {
    private let poller = Poller()
    private var lastTicks: (busy: UInt64, total: UInt64)?
    private var lastBytes: (bytes: UInt64, time: Double)?
    let channels: [ChannelInfo] = [
        ChannelInfo(id: "mac.thermal", kind: "thermal", label: "Heat (thermal state)", range: (0, 1), adaptive: false, rateHz: 1),
        ChannelInfo(id: "mac.cpu", kind: "cpu.load", label: "CPU load", range: (0, 1), adaptive: false, rateHz: 2),
        ChannelInfo(id: "mac.memory", kind: "memory.pressure", label: "Memory in use", range: (0, 1), adaptive: false, rateHz: 1),
        ChannelInfo(id: "mac.idle", kind: "idle", label: "Idle time", unit: "s", range: (0, 120), adaptive: false, rateHz: 2),
        ChannelInfo(id: "mac.network", kind: "network.rate", label: "Network traffic", unit: "KB/s", minSpan: 50, rateHz: 1),
    ]

    func start(_ emit: @escaping (String, Double) -> Void) {
        poller.start(every: 0.5) { [weak self] in
            guard let self else { return }
            emit("mac.thermal", Double(ProcessInfo.processInfo.thermalState.rawValue) / 3)
            if let load = self.cpuLoad() { emit("mac.cpu", load) }
            if let memory = Self.memoryInUse() { emit("mac.memory", memory) }
            if let any = CGEventType(rawValue: ~0) {
                emit("mac.idle", CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: any))
            }
            if let rate = self.networkRate() { emit("mac.network", rate / 1024) }
        }
    }

    func stop() {
        poller.stop()
    }

    private func cpuLoad() -> Double? {
        var info = host_cpu_load_info()
        var count = mach_msg_type_number_t(MemoryLayout<host_cpu_load_info_data_t>.stride / MemoryLayout<integer_t>.stride)
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                host_statistics(mach_host_self(), HOST_CPU_LOAD_INFO, $0, &count)
            }
        }
        guard result == KERN_SUCCESS else { return nil }
        let user = UInt64(info.cpu_ticks.0)
        let system = UInt64(info.cpu_ticks.1)
        let idle = UInt64(info.cpu_ticks.2)
        let nice = UInt64(info.cpu_ticks.3)
        let busy = user + system + nice
        let total = busy + idle
        defer { lastTicks = (busy, total) }
        guard let last = lastTicks, total > last.total else { return nil }
        return Double(busy - last.busy) / Double(total - last.total)
    }

    /// macOS's memory status level is the share of memory still free.
    private static func memoryInUse() -> Double? {
        var level: Int32 = 0
        var size = MemoryLayout<Int32>.size
        guard sysctlbyname("kern.memorystatus_level", &level, &size, nil, 0) == 0 else { return nil }
        return 1 - Double(level) / 100
    }

    private func networkRate() -> Double? {
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return nil }
        defer { freeifaddrs(list) }
        var bytes: UInt64 = 0
        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let entry = cursor {
            let name = String(cString: entry.pointee.ifa_name)
            if let addr = entry.pointee.ifa_addr, addr.pointee.sa_family == UInt8(AF_LINK),
                !name.hasPrefix("lo"), let data = entry.pointee.ifa_data
            {
                let stats = data.assumingMemoryBound(to: if_data.self).pointee
                bytes += UInt64(stats.ifi_ibytes) + UInt64(stats.ifi_obytes)
            }
            cursor = entry.pointee.ifa_next
        }
        let now = ProcessInfo.processInfo.systemUptime
        defer { lastBytes = (bytes, now) }
        // The counters are 32-bit and wrap; skip the sample when they do.
        guard let last = lastBytes, bytes >= last.bytes, now > last.time else { return nil }
        return Double(bytes - last.bytes) / (now - last.time)
    }
}

// MARK: - Wi-Fi

/// Wi-Fi signal strength and noise.
final class WiFiReader: NativeReader {
    private let poller = Poller()
    private let interface = CWWiFiClient.shared().interface()
    private(set) var channels: [ChannelInfo] = []

    init() {
        if interface != nil {
            channels = [
                ChannelInfo(id: "mac.wifi", kind: "wifi.rssi", label: "Wi-Fi signal", unit: "dBm", range: (-100, -30), adaptive: false, rateHz: 1),
                ChannelInfo(id: "mac.wifiNoise", kind: "wifi.noise", label: "Wi-Fi noise", unit: "dBm", minSpan: 5, rateHz: 1),
            ]
        }
    }

    func start(_ emit: @escaping (String, Double) -> Void) {
        poller.start(every: 1) { [weak self] in
            guard let wifi = self?.interface else { return }
            let rssi = wifi.rssiValue()
            if rssi != 0 { emit("mac.wifi", Double(rssi)) }
            let noise = wifi.noiseMeasurement()
            if noise != 0 { emit("mac.wifiNoise", Double(noise)) }
        }
    }

    func stop() {
        poller.stop()
    }
}

// MARK: - Bluetooth

/// How many Bluetooth devices are around, and how close the nearest one is.
final class BluetoothReader: NSObject, NativeReader, CBCentralManagerDelegate {
    private var central: CBCentralManager?
    private var seen: [UUID: (rssi: Double, time: Double)] = [:]
    private let lock = NSLock()
    private let poller = Poller()
    let channels: [ChannelInfo] = [
        ChannelInfo(id: "mac.btDevices", kind: "bluetooth.devices", label: "Bluetooth devices nearby", range: (0, 30), rateHz: 1),
        ChannelInfo(id: "mac.btNearest", kind: "bluetooth.rssi", label: "Nearest Bluetooth device", unit: "dBm", range: (-100, -30), adaptive: false, rateHz: 1),
    ]

    func start(_ emit: @escaping (String, Double) -> Void) {
        // Creating the manager is what asks for Bluetooth permission, so wait until now.
        if central == nil { central = CBCentralManager(delegate: self, queue: DispatchQueue.global(qos: .utility)) }
        poller.start(every: 1) { [weak self] in
            guard let self else { return }
            let now = ProcessInfo.processInfo.systemUptime
            self.lock.lock()
            self.seen = self.seen.filter { now - $0.value.time < 30 }
            let devices = self.seen.count
            let nearest = self.seen.values.map { $0.rssi }.max()
            self.lock.unlock()
            emit("mac.btDevices", Double(devices))
            if let nearest { emit("mac.btNearest", nearest) }
        }
    }

    func stop() {
        poller.stop()
        central?.stopScan()
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn {
            central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
        }
    }

    func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi RSSI: NSNumber
    ) {
        let rssi = RSSI.doubleValue
        guard rssi < 0 else { return }
        lock.lock()
        seen[peripheral.identifier] = (rssi, ProcessInfo.processInfo.systemUptime)
        lock.unlock()
    }
}
