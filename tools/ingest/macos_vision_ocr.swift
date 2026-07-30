import AppKit
import Foundation
import PDFKit
import Vision

guard CommandLine.arguments.count == 2 else {
    fputs("usage: macos_vision_ocr.swift <pdf>\n", stderr)
    exit(64)
}

let source = URL(fileURLWithPath: CommandLine.arguments[1])
guard let document = PDFDocument(url: source) else {
    fputs("cannot open PDF: \(source.path)\n", stderr)
    exit(65)
}

var pages: [[String: Any]] = []
for index in 0..<document.pageCount {
    guard let page = document.page(at: index) else { continue }
    let bounds = page.bounds(for: .mediaBox)
    let scale = 1800.0 / max(bounds.width, 1)
    let image = page.thumbnail(
        of: NSSize(width: 1800, height: max(1, bounds.height * scale)), for: .mediaBox
    )
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
