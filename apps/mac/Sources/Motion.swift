import Foundation

/**
 * The accelerometer and gyroscope of Apple Silicon MacBooks sit behind
 * AppleSPUHIDDevice, which only root can read. When the user turns motion on,
 * this asks for the admin password (the standard macOS prompt) to start the
 * bundled `sensinth-motion` helper, which streams readings back over a Unix
 * socket. Closing the socket (stopping, or quitting the app) ends the helper.
 */
final class MotionHelper {
    static var helperURL: URL? { Bundle.main.url(forAuxiliaryExecutable: "sensinth-motion") }
    static var available: Bool { helperURL != nil }

    static let channels: [ChannelInfo] = [
        ChannelInfo(id: "mac.shake", kind: "motion.accel", label: "Shake (Mac)", unit: "m/s²", range: (0, 20), minSpan: 0.4, rateHz: 50),
        ChannelInfo(id: "mac.rotation", kind: "rotation.rate", label: "Rotation (Mac)", unit: "°/s", range: (0, 360), minSpan: 15, rateHz: 50),
        ChannelInfo(id: "mac.pitch", kind: "orientation.pitch", label: "Tilt forward–back (Mac)", unit: "°", range: (-90, 90), minSpan: 10, rateHz: 50),
        ChannelInfo(id: "mac.roll", kind: "orientation.roll", label: "Tilt left–right (Mac)", unit: "°", range: (-90, 90), minSpan: 10, rateHz: 50),
    ]

    private var listenFD: Int32 = -1
    private var clientFD: Int32 = -1
    private var socketPath = ""
    private var running = false

    func start(emit: @escaping (String, Double) -> Void, status: @escaping (String, String?) -> Void) {
        if running {
            status("on", nil)
            return
        }
        guard let helper = Self.helperURL else {
            status("error", "The motion helper is missing from the app.")
            return
        }
        guard listenOnSocket() else {
            status("error", "Could not open a socket for the motion helper.")
            return
        }
        running = true
        Thread { [weak self] in self?.acceptAndRead(emit: emit, status: status) }.start()

        let script = """
            do shell script (quoted form of "\(Self.escape(helper.path))") & " " & (quoted form of "\(Self.escape(socketPath))") & " > /dev/null 2>&1 &" \
            with prompt "Sensinth wants to read your Mac's accelerometer and gyroscope." with administrator privileges
            """
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]
        let errors = Pipe()
        process.standardError = errors
        process.terminationHandler = { [weak self] finished in
            guard finished.terminationStatus != 0 else { return }
            let text = String(data: errors.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            let cancelled = text.contains("-128") || text.lowercased().contains("cancel")
            status("error", cancelled ? "Cancelled: motion needs your password." : "Could not start the motion helper.")
            self?.stop()
        }
        do {
            try process.run()
        } catch {
            status("error", "Could not ask for the password: \(error.localizedDescription)")
            stop()
        }
    }

    func stop() {
        guard running else { return }
        running = false
        if clientFD >= 0 { close(clientFD) }
        if listenFD >= 0 {
            shutdown(listenFD, SHUT_RDWR)
            close(listenFD)
        }
        clientFD = -1
        listenFD = -1
        unlink(socketPath)
    }

    private func listenOnSocket() -> Bool {
        socketPath = NSTemporaryDirectory() + "sensinth-motion-\(getpid()).sock"
        unlink(socketPath)
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let path = Array(socketPath.utf8)
        let fits = withUnsafeMutableBytes(of: &addr.sun_path) { dst -> Bool in
            guard path.count < dst.count else { return false }
            for (i, byte) in path.enumerated() { dst[i] = byte }
            dst[path.count] = 0
            return true
        }
        let size = socklen_t(MemoryLayout<sockaddr_un>.size)
        let bound = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, size) }
        }
        guard fits, bound == 0, listen(fd, 1) == 0 else {
            close(fd)
            return false
        }
        listenFD = fd
        return true
    }

    /// Waits for the helper, then turns its lines ("a x y z" in g, "g x y z" in °/s) into channels.
    private func acceptAndRead(emit: @escaping (String, Double) -> Void, status: @escaping (String, String?) -> Void) {
        let client = accept(listenFD, nil, nil)
        guard client >= 0, running else { return }
        clientFD = client
        status("on", nil)
        var buffer: [UInt8] = []
        let size = 4096
        var chunk = [UInt8](repeating: 0, count: size)
        while running {
            let n = read(client, &chunk, size)
            if n <= 0 { break }
            buffer.append(contentsOf: chunk[0..<n])
            while let newline = buffer.firstIndex(of: 10) {
                let line = String(decoding: buffer[..<newline], as: UTF8.self)
                buffer.removeSubrange(...newline)
                handle(line, emit: emit, status: status)
            }
        }
        if running {
            status("error", "The motion helper stopped.")
            stop()
        }
    }

    private func handle(_ line: String, emit: (String, Double) -> Void, status: (String, String?) -> Void) {
        let parts = line.split(separator: " ")
        guard let tag = parts.first else { return }
        if tag == "e" {
            status("error", parts.dropFirst().joined(separator: " "))
            return
        }
        let v = parts.dropFirst().compactMap { Double($0) }
        guard v.count == 3 else { return }
        let (x, y, z) = (v[0], v[1], v[2])
        if tag == "a" {
            let g = (x * x + y * y + z * z).squareRoot()
            emit("mac.shake", abs(g - 1) * 9.81)
            emit("mac.pitch", atan2(-x, (y * y + z * z).squareRoot()) * 180 / .pi)
            emit("mac.roll", atan2(y, z) * 180 / .pi)
        } else if tag == "g" {
            emit("mac.rotation", (x * x + y * y + z * z).squareRoot())
        }
    }

    private static func escape(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
    }
}
