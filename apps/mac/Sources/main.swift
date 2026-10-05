import AppKit

// Sensinth for Mac: the web app in a window, plus the sensors only a native
// app can read (see Bridge.swift and Readers.swift).
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
