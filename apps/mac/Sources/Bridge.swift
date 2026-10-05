import Foundation
import WebKit

/// A channel as the page sees it (mirrors SensorDescriptor in the web app).
struct ChannelInfo {
    let id: String
    let kind: String
    let label: String
    var unit: String? = nil
    var range: (Double, Double)? = nil
    var adaptive = true
    var minSpan: Double? = nil
    var rateHz: Double = 1

    var json: [String: Any] {
        var o: [String: Any] = ["id": id, "kind": kind, "label": label, "adaptive": adaptive, "rateHz": rateHz]
        if let unit { o["unit"] = unit }
        if let range { o["range"] = [range.0, range.1] }
        if let minSpan { o["minSpan"] = minSpan }
        return o
    }
}

/// Something on the Mac that reads one or more channels.
protocol NativeReader: AnyObject {
    /// The channels this Mac has; empty when the hardware is missing.
    var channels: [ChannelInfo] { get }
    /// Starts reading; `emit` may be called from any thread.
    func start(_ emit: @escaping (String, Double) -> Void)
    func stop()
}

/**
 * Talks to the page. The page posts `{type: "describe" | "start" | "stop"}`
 * and `{type: "motion", on}` to `webkit.messageHandlers.sensinth`; the app
 * answers through `window.sensinthNative.receive(message)`: the channel list,
 * the motion helper's status, and every 50 ms the latest value of each
 * channel that changed (`{type: "readings", r: [[id, value], …]}`).
 */
final class Bridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?
    private let readers: [NativeReader] = [
        LidReader(),
        HIDEventReader(),
        BatteryReader(),
        SystemReader(),
        WiFiReader(),
        BluetoothReader(),
    ]
    private let motion = MotionHelper()
    private var pending: [String: Double] = [:]
    private let lock = NSLock()
    private var timer: Timer?
    private var running = false

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "describe":
            send([
                "type": "describe",
                "channels": readers.flatMap { $0.channels }.map { $0.json },
                "motion": MotionHelper.available,
            ])
        case "start":
            start()
        case "stop":
            stopReaders()
        case "motion":
            if body["on"] as? Bool == true { startMotion() } else { motion.stop() }
        default:
            break
        }
    }

    /// Stops everything, including the motion helper, when the app quits.
    func shutdown() {
        stopReaders()
        motion.stop()
    }

    private func start() {
        if !running {
            running = true
            for reader in readers where !reader.channels.isEmpty {
                reader.start { [weak self] id, value in self?.put(id, value) }
            }
        }
        ensureTimer()
    }

    private func stopReaders() {
        guard running else { return }
        running = false
        for reader in readers { reader.stop() }
    }

    private func startMotion() {
        ensureTimer()
        motion.start(
            emit: { [weak self] id, value in self?.put(id, value) },
            status: { [weak self] status, detail in
                var message: [String: Any] = ["type": "motion", "status": status]
                if let detail { message["message"] = detail }
                if status == "on" { message["channels"] = MotionHelper.channels.map { $0.json } }
                DispatchQueue.main.async { self?.send(message) }
            }
        )
    }

    private func ensureTimer() {
        guard timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            self?.flush()
        }
    }

    private func put(_ id: String, _ value: Double) {
        guard value.isFinite else { return }
        lock.lock()
        pending[id] = value
        lock.unlock()
    }

    private func flush() {
        lock.lock()
        let batch = pending
        pending.removeAll()
        lock.unlock()
        guard !batch.isEmpty else { return }
        send(["type": "readings", "r": batch.map { [$0.key, $0.value] as [Any] }])
    }

    private func send(_ message: [String: Any]) {
        guard let webView,
            let data = try? JSONSerialization.data(withJSONObject: message),
            let json = String(data: data, encoding: .utf8)
        else { return }
        webView.evaluateJavaScript("window.sensinthNative && window.sensinthNative.receive(\(json))")
    }
}
