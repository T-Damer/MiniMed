import AppKit
import Foundation
import PDFKit
import Vision

// usage: macos_vision_ocr.swift <pdf> [--pages 19,20] [--rotate 90]
// `--rotate` turns each page clockwise by that many degrees before recognition (a scan stored
// sideways); the page size and the boxes then describe the rotated page.
let arguments = Array(CommandLine.arguments.dropFirst())
guard let pdfArgument = arguments.first, !pdfArgument.hasPrefix("--") else {
    fputs("usage: macos_vision_ocr.swift <pdf> [--pages 19,20] [--rotate 90]\n", stderr)
    exit(64)
}
func option(_ name: String) -> String? {
    guard let at = arguments.firstIndex(of: name), at + 1 < arguments.count else { return nil }
    return arguments[at + 1]
}
let onlyPages: Set<Int>? = option("--pages").map { Set($0.split(separator: ",").compactMap { Int($0) }) }
let rotation = Int(option("--rotate") ?? "0") ?? 0

let source = URL(fileURLWithPath: pdfArgument)
guard let document = PDFDocument(url: source) else {
    fputs("cannot open PDF: \(source.path)\n", stderr)
    exit(65)
}

var pages: [[String: Any]] = []
for index in 0..<document.pageCount {
    guard let page = document.page(at: index) else { continue }
    if let only = onlyPages, !only.contains(index + 1) { continue }
    var bounds = page.bounds(for: .mediaBox)
    let scale = 1800.0 / max(bounds.width, 1)
    var image = page.thumbnail(
        of: NSSize(width: 1800, height: max(1, bounds.height * scale)), for: .mediaBox
    )
    if rotation != 0 {
        let radians = CGFloat(-rotation) * .pi / 180
        let turned = rotation % 180 == 90
        let size = turned ? NSSize(width: image.size.height, height: image.size.width) : image.size
        let target = NSImage(size: size)
        target.lockFocus()
        let transform = NSAffineTransform()
        transform.translateX(by: size.width / 2, yBy: size.height / 2)
        transform.rotate(byRadians: radians)
        transform.translateX(by: -image.size.width / 2, yBy: -image.size.height / 2)
        transform.concat()
        image.draw(in: NSRect(origin: .zero, size: image.size))
        target.unlockFocus()
        image = target
        if turned { bounds = NSRect(x: 0, y: 0, width: bounds.height, height: bounds.width) }
    }
    var rect = NSRect(origin: .zero, size: image.size)
    guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { continue }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["ru-RU", "en-US"]
    request.usesLanguageCorrection = true
    try VNImageRequestHandler(cgImage: cgImage).perform([request])
    let lines = (request.results ?? []).compactMap { observation -> [String: Any]? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        return [
            "text": candidate.string,
            "confidence": Double(candidate.confidence),
            "bbox": [Double(box.origin.x), Double(box.origin.y), Double(box.width), Double(box.height)],
        ]
    }.sorted {
        let left = $0["bbox"] as! [Double]
        let right = $1["bbox"] as! [Double]
        if abs(left[1] - right[1]) > 0.012 { return left[1] > right[1] }
        return left[0] < right[0]
    }
    pages.append([
        "page": index + 1,
        "width": bounds.width,
        "height": bounds.height,
        "lines": lines,
    ])
}

let output: [String: Any] = ["format": "macos-vision-ocr-v1", "pages": pages]
let payload = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
FileHandle.standardOutput.write(payload)
FileHandle.standardOutput.write(Data("\n".utf8))
