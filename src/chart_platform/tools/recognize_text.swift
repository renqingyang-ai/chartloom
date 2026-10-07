import Foundation
import Vision
import AppKit
let args=CommandLine.arguments
if args.count != 2 { exit(2) }
let request=VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US", "zh-Hans"]
request.minimumTextHeight = 0.003
let handler=VNImageRequestHandler(url:URL(fileURLWithPath:args[1]),options:[:])
do {
 try handler.perform([request])
 var records=[[String:Any]]()
 for observation in request.results ?? [] {
  guard let candidate=observation.topCandidates(1).first else {continue}
  let text=candidate.string
  func emit(_ value:String,_ rect:CGRect,_ word:Bool) {
   records.append(["text":value,"bbox":[rect.minX*100,(1-rect.maxY)*100,rect.width*100,rect.height*100],"confidence":candidate.confidence,"word":word])
  }
  emit(text,observation.boundingBox,false)
  if text.contains(" ") {
   let pattern="\\S+"
   if let regex=try? NSRegularExpression(pattern:pattern) {
    for match in regex.matches(in:text,range:NSRange(text.startIndex...,in:text)) {
     if let range=Range(match.range,in:text), let box=try? candidate.boundingBox(for:range) { emit(String(text[range]),box.boundingBox,true) }
    }
   }
  }
 }
 let data=try JSONSerialization.data(withJSONObject:["method":"macos-vision-local-ocr","spans":records],options:[.sortedKeys])
 FileHandle.standardOutput.write(data)
} catch {
 FileHandle.standardError.write(Data("Local OCR failed\n".utf8));exit(1)
}
