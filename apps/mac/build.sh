#!/usr/bin/env bash
# Builds Sensinth.app (Apple Silicon and Intel) and Sensinth-mac.zip in apps/mac/build.
# Needs macOS with the Xcode command-line tools, and the web app built for
# native shells first:  NATIVE=1 pnpm --filter @sensinth/web build
set -euo pipefail
cd "$(dirname "$0")"

WEB=../web/dist
OUT=build
APP="$OUT/Sensinth.app"
BUILD="${BUILD_NUMBER:-1}"
MIN_MACOS=13.0
FRAMEWORKS=(-framework AppKit -framework WebKit -framework IOKit -framework CoreWLAN -framework CoreBluetooth -framework Network)

if [ ! -f "$WEB/index.html" ]; then
  echo "No web build in $WEB. Run: NATIVE=1 pnpm --filter @sensinth/web build" >&2
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

for arch in arm64 x86_64; do
  echo "Compiling for $arch…"
  swiftc -O -swift-version 5 -target "$arch-apple-macos$MIN_MACOS" \
    -o "$OUT/Sensinth-$arch" Sources/*.swift "${FRAMEWORKS[@]}"
  swiftc -O -swift-version 5 -target "$arch-apple-macos$MIN_MACOS" \
    -o "$OUT/sensinth-motion-$arch" Helper/main.swift -framework IOKit
done
lipo -create -output "$APP/Contents/MacOS/Sensinth" "$OUT"/Sensinth-arm64 "$OUT"/Sensinth-x86_64
lipo -create -output "$APP/Contents/MacOS/sensinth-motion" "$OUT"/sensinth-motion-arm64 "$OUT"/sensinth-motion-x86_64

sed "s/__BUILD__/$BUILD/g" Info.plist > "$APP/Contents/Info.plist"
plutil -lint "$APP/Contents/Info.plist"
cp -R "$WEB" "$APP/Contents/Resources/web"

# The icon, from the web app's 512 px icon.
ICONSET="$OUT/AppIcon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" ../web/public/icons/icon-512.png --out "$ICONSET/icon_${size}x${size}.png" > /dev/null
  double=$((size * 2))
  sips -z "$double" "$double" ../web/public/icons/icon-512.png --out "$ICONSET/icon_${size}x${size}@2x.png" > /dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

# Ad-hoc signature: enough to run on Apple Silicon after "Open Anyway".
codesign --force --sign - "$APP/Contents/MacOS/sensinth-motion"
codesign --force --sign - "$APP"
codesign --verify --verbose "$APP"

(cd "$OUT" && ditto -c -k --keepParent Sensinth.app Sensinth-mac.zip)
echo "Built $OUT/Sensinth.app and $OUT/Sensinth-mac.zip"
