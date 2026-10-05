// sensinth-motion: reads the accelerometer and gyroscope of Apple Silicon
// MacBooks (AppleSPUHIDDevice, which needs root) and streams them to the
// Sensinth app over the Unix socket given as the only argument:
//   "a x y z\n"  acceleration in g
//   "g x y z\n"  rotation in degrees per second
//   "e message\n" when it cannot read them
// It exits when the app closes the socket.

import Foundation
import IOKit
import IOKit.hid

signal(SIGPIPE, SIG_IGN)

guard CommandLine.arguments.count > 1 else {
    FileHandle.standardError.write(Data("usage: sensinth-motion <socket>\n".utf8))
    exit(2)
}

let socketFD: Int32 = {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    let path = Array(CommandLine.arguments[1].utf8)
    withUnsafeMutableBytes(of: &addr.sun_path) { dst in
        for (i, byte) in path.prefix(dst.count - 1).enumerated() { dst[i] = byte }
    }
    let size = socklen_t(MemoryLayout<sockaddr_un>.size)
    let connected = withUnsafePointer(to: &addr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, size) }
    }
    if fd < 0 || connected != 0 { exit(3) }
    return fd
}()

/// Sends one line; the app has gone when it cannot be written.
func send(_ line: String) {
    let bytes = Array(line.utf8)
    if write(socketFD, bytes, bytes.count) < 0 { exit(0) }
}

/// Asks the sensor drivers to power up and report every 10 ms.
func wakeDrivers() {
    var iterator: io_iterator_t = 0
    guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("AppleSPUHIDDriver"), &iterator) == KERN_SUCCESS else { return }
    var service = IOIteratorNext(iterator)
    while service != 0 {
        IORegistryEntrySetCFProperty(service, "SensorPropertyReportingState" as CFString, NSNumber(value: 1))
        IORegistryEntrySetCFProperty(service, "SensorPropertyPowerState" as CFString, NSNumber(value: 1))
        IORegistryEntrySetCFProperty(service, "ReportInterval" as CFString, NSNumber(value: 10000))
        IOObjectRelease(service)
        service = IOIteratorNext(iterator)
    }
    IOObjectRelease(iterator)
}

func property(_ service: io_service_t, _ key: String) -> Int {
    (IORegistryEntryCreateCFProperty(service, key as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? NSNumber)?.intValue ?? -1
}

/// Usages on Apple's vendor page 0xff00.
let accelerometerUsage = 3
let gyroscopeUsage = 9
var lastSent: [Int: Double] = [:]

let callback: IOHIDReportCallback = { context, _, _, _, _, report, length in
    guard length >= 18 else { return }
    let usage = Int(bitPattern: context)
    let now = ProcessInfo.processInfo.systemUptime
    // At most 50 lines a second per sensor.
    if let last = lastSent[usage], now - last < 0.02 { return }
    lastSent[usage] = now
    func axis(_ offset: Int) -> Double {
        let raw = UInt32(report[offset]) | UInt32(report[offset + 1]) << 8 | UInt32(report[offset + 2]) << 16 | UInt32(report[offset + 3]) << 24
        return Double(Int32(bitPattern: raw)) / 65536
    }
    let tag = usage == accelerometerUsage ? "a" : "g"
    send(String(format: "%@ %.4f %.4f %.4f\n", tag, axis(6), axis(10), axis(14)))
}

wakeDrivers()

var devices: [IOHIDDevice] = []
var iterator: io_iterator_t = 0
if IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("AppleSPUHIDDevice"), &iterator) == KERN_SUCCESS {
    var service = IOIteratorNext(iterator)
    while service != 0 {
        let page = property(service, "PrimaryUsagePage")
        let usage = property(service, "PrimaryUsage")
        if page == 0xFF00, usage == accelerometerUsage || usage == gyroscopeUsage,
            let device = IOHIDDeviceCreate(kCFAllocatorDefault, service)
        {
            IOHIDDeviceOpen(device, IOOptionBits(kIOHIDOptionsTypeNone))
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 4096)
            IOHIDDeviceRegisterInputReportCallback(device, buffer, 4096, callback, UnsafeMutableRawPointer(bitPattern: usage))
            IOHIDDeviceScheduleWithRunLoop(device, CFRunLoopGetCurrent(), CFRunLoopMode.defaultMode.rawValue)
            devices.append(device)
        }
        IOObjectRelease(service)
        service = IOIteratorNext(iterator)
    }
    IOObjectRelease(iterator)
}

if devices.isEmpty {
    send("e This Mac has no motion sensor the app can read.\n")
    exit(4)
}

// Also notice the app leaving while no readings flow.
Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in send("k 0 0 0\n") }
CFRunLoopRun()
