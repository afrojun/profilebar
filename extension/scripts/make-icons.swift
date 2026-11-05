// Makes the extension icons from the app icon: cuts the three panels out of its navy background and lays them out
// with whole-pixel edges and at least a one-pixel gap, so the panels stay distinct at toolbar sizes.
// From the repository root:
//   swift extension/scripts/make-icons.swift Resources/ProfileBarIcon.png extension/icons [preview.png]
// The optional preview magnifies each size on light and dark toolbar colours.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let source = URL(fileURLWithPath: CommandLine.arguments[1])
let outDir = URL(fileURLWithPath: CommandLine.arguments[2])
let previewURL = CommandLine.arguments.count > 3 ? URL(fileURLWithPath: CommandLine.arguments[3]) : nil
let image = CGImageSourceCreateImageAtIndex(CGImageSourceCreateWithURL(source as CFURL, nil)!, 0, nil)!
let w = image.width, h = image.height
let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!
let premultiplied = CGImageAlphaInfo.premultipliedLast.rawValue

var px = [UInt8](repeating: 0, count: w * h * 4)
CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: sRGB,
  bitmapInfo: premultiplied)!.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))

// Alpha ramps up between the navy's brightest channel (117) and the panels' darkest (about 199). Edge colours are
// unmixed from the local navy so the cut-out edges carry no dark fringe.
let background = (r: 2.0, g: 36.0, b: 88.0)
func smoothstep(_ lo: Double, _ hi: Double, _ x: Double) -> Double { let t = min(max((x - lo) / (hi - lo), 0), 1); return t * t * (3 - 2 * t) }
var alpha = [Double](repeating: 0, count: w * h)
for i in 0..<(w * h) {
  let r = Double(px[i * 4]), g = Double(px[i * 4 + 1]), b = Double(px[i * 4 + 2])
  let a = smoothstep(130, 185, max(r, g, b))
  alpha[i] = a
  func unmix(_ c: Double, _ bg: Double) -> UInt8 { a == 0 ? 0 : UInt8(min(max((c - (1 - a) * bg) / a, 0), 255) * a) }
  px[i * 4] = unmix(r, background.r); px[i * 4 + 1] = unmix(g, background.g); px[i * 4 + 2] = unmix(b, background.b)
  px[i * 4 + 3] = UInt8(a * 255)
}

// Each panel is a run of columns with opaque pixels, separated from the next by fully transparent columns.
func columnHasPanel(_ x: Int) -> Bool { (0..<h).contains { alpha[$0 * w + x] > 0.5 } }
var panels: [CGRect] = []
var x = 0
while x < w {
  if !columnHasPanel(x) { x += 1; continue }
  let start = x
  while x < w && columnHasPanel(x) { x += 1 }
  let rows = (0..<h).filter { y in (start..<x).contains { alpha[y * w + $0] > 0.5 } }
  panels.append(CGRect(x: start, y: rows.first!, width: x - start, height: rows.last! - rows.first! + 1))
}
precondition(panels.count == 3, "expected three panels, found \(panels.count)")
let cutout = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: sRGB,
  bitmapInfo: premultiplied)!.makeImage()!

func render(size: Int) -> CGImage {
  let gap = max(1, Int((Double(size) * 0.05).rounded()))
  // The Web Store wants 96 pixels of artwork inside a 128-pixel icon. Toolbar sizes fill the icon so they stay legible.
  let pad = size == 128 ? 16 : Int((Double(size) * 0.02).rounded())
  let available = Double(size - 2 * pad - 2 * gap)
  let total = panels.reduce(0) { $0 + $1.width }
  let scale = available / Double(total)
  var widths = panels.map { Int(($0.width * scale).rounded()) }
  widths[1] += Int(available) - widths.reduce(0, +)   // keep the outer edges on the padding
  let top = panels.map(\.minY).min()!, bottom = panels.map(\.maxY).max()!
  let yOffset = (Double(size) - (bottom - top) * scale) / 2
  let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: sRGB, bitmapInfo: premultiplied)!
  ctx.interpolationQuality = .high
  var left = pad
  for (panel, width) in zip(panels, widths) {
    let y0 = (yOffset + (panel.minY - top) * scale).rounded()
    let y1 = (yOffset + (panel.maxY - top) * scale).rounded()
    let crop = cutout.cropping(to: panel)!
    // CGContext's origin is the bottom left, so flip the top-left layout.
    ctx.draw(crop, in: CGRect(x: Double(left), y: Double(size) - y1, width: Double(width), height: y1 - y0))
    left += width + gap
  }
  return ctx.makeImage()!
}

func write(_ image: CGImage, to url: URL) {
  let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, image, nil)
  precondition(CGImageDestinationFinalize(dest))
}

var icons: [Int: CGImage] = [:]
for size in [16, 32, 48, 128] {
  icons[size] = render(size: size)
  write(icons[size]!, to: outDir.appendingPathComponent("icon-\(size).png"))
}

guard let previewURL else { exit(0) }
// Each size magnified with hard pixels, on Chrome's light and dark toolbar colours.
let zoom = 6, cell = 128 * 2 + 24
let preview = CGContext(data: nil, width: cell * 4, height: cell * 2, bitsPerComponent: 8, bytesPerRow: 0, space: sRGB, bitmapInfo: premultiplied)!
preview.interpolationQuality = .none
for (row, shade) in [(0, 0.95), (1, 0.18)] {
  preview.setFillColor(CGColor(gray: shade, alpha: 1)); preview.fill(CGRect(x: 0, y: row * cell, width: cell * 4, height: cell))
  for (column, size) in [16, 32, 48, 128].enumerated() {
    let side = size == 128 ? 256 : size * zoom
    preview.draw(icons[size]!, in: CGRect(x: column * cell + (cell - side) / 2, y: row * cell + (cell - side) / 2, width: side, height: side))
  }
}
write(preview.makeImage()!, to: previewURL)
