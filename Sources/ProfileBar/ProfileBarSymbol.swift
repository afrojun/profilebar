import AppKit

enum ProfileBarSymbol {
    static func image(size: CGFloat = 18, isDevelopment: Bool = false) -> NSImage {
        let image = NSImage(size: NSSize(width: size, height: size), flipped: false) { bounds in
            let scale = bounds.width / 18
            let panels = [
                NSRect(x: 1, y: 3, width: 4.25, height: 12),
                NSRect(x: 6.25, y: 1.5, width: 5.5, height: 15),
                NSRect(x: 12.75, y: 3, width: 4.25, height: 12),
            ]
            for rect in panels {
                if isDevelopment {
                    let border: CGFloat = 1.4
                    let outline = panel(rect.insetBy(dx: border / 2, dy: border / 2), scale: scale)
                    outline.lineWidth = border * scale
                    NSColor.labelColor.setStroke()
                    outline.stroke()
                } else {
                    NSColor.labelColor.setFill()
                    panel(rect, scale: scale).fill()
                }
            }
            return true
        }
        image.isTemplate = true
        return image
    }

    private static func panel(_ rect: NSRect, scale: CGFloat) -> NSBezierPath {
        let scaled = NSRect(
            x: rect.origin.x * scale,
            y: rect.origin.y * scale,
            width: rect.width * scale,
            height: rect.height * scale
        )
        return NSBezierPath(roundedRect: scaled, xRadius: 1.5 * scale, yRadius: 1.5 * scale)
    }
}
