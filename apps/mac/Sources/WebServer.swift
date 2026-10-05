import Foundation
import Network

/**
 * A tiny web server on 127.0.0.1 that serves the web app from the bundle.
 * The page needs a secure context for the camera and microphone, and
 * loopback http counts as one. It prefers a fixed port, so the page keeps
 * its settings (local storage) from one launch to the next.
 */
final class WebServer {
    private var listener: NWListener?
    private var root = URL(fileURLWithPath: "/")
    private let queue = DispatchQueue(label: "sensinth.web")
    static let preferredPort: UInt16 = 47123

    func start(root: URL, ready: @escaping (UInt16) -> Void) {
        self.root = root.standardizedFileURL
        listen(on: NWEndpoint.Port(rawValue: Self.preferredPort) ?? .any, ready: ready)
    }

    private func listen(on port: NWEndpoint.Port, ready: @escaping (UInt16) -> Void) {
        let params = NWParameters.tcp
        params.requiredInterfaceType = .loopback
        params.allowLocalEndpointReuse = true
        guard let listener = try? NWListener(using: params, on: port) else {
            if port != .any { listen(on: .any, ready: ready) }
            return
        }
        listener.newConnectionHandler = { [weak self] connection in
            self?.serve(connection)
        }
        listener.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                if let value = listener.port?.rawValue {
                    DispatchQueue.main.async { ready(value) }
                }
            case .failed:
                listener.cancel()
                // The preferred port is taken: any free one will do.
                if port != .any { self?.listen(on: .any, ready: ready) }
            default:
                break
            }
        }
        listener.start(queue: queue)
        self.listener = listener
    }

    private func serve(_ connection: NWConnection) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, _, _ in
            guard let self, let data, let request = String(data: data, encoding: .utf8) else {
                connection.cancel()
                return
            }
            let line = request.components(separatedBy: "\r\n").first ?? ""
            let parts = line.components(separatedBy: " ")
            var path = parts.count > 1 ? parts[1] : "/"
            if let cut = path.firstIndex(where: { $0 == "?" || $0 == "#" }) {
                path = String(path[..<cut])
            }
            path = path.removingPercentEncoding ?? path
            if path.hasSuffix("/") { path += "index.html" }
            let file = self.root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
            // Never serve anything outside the web folder.
            let inside = file.path.hasPrefix(self.root.path + "/")
            if inside, let body = try? Data(contentsOf: file) {
                self.respond(connection, status: "200 OK", type: Self.mimeType(file.pathExtension), body: body)
            } else {
                self.respond(connection, status: "404 Not Found", type: "text/plain", body: Data("Not found".utf8))
            }
        }
    }

    private func respond(_ connection: NWConnection, status: String, type: String, body: Data) {
        let head = "HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n"
        var data = Data(head.utf8)
        data.append(body)
        connection.send(content: data, completion: .contentProcessed { _ in connection.cancel() })
    }

    static func mimeType(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json"
        case "webmanifest": return "application/manifest+json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "ico": return "image/x-icon"
        case "woff2": return "font/woff2"
        case "wav": return "audio/wav"
        default: return "application/octet-stream"
        }
    }
}
