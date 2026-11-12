import UIKit
import Photos
import Capacitor

/// Saves and shares the story images (anonymous messages as JPEG cards) from the web app, the same
/// as the Android TreehouseImagePlugin:
///   Capacitor.Plugins.TreehouseImage.save({ data: <base64 jpeg or data: URL>, filename })  -> Photos
///   Capacitor.Plugins.TreehouseImage.share({ data, filename, text })                         -> share sheet
@objc(TreehouseImagePlugin)
public class TreehouseImagePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TreehouseImagePlugin"
    public let jsName = "TreehouseImage"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise)
    ]

    private func imageData(_ call: CAPPluginCall) -> Data? {
        guard var text = call.getString("data"), !text.isEmpty else { call.reject("No image."); return nil }
        if text.hasPrefix("data:"), let comma = text.firstIndex(of: ",") { text = String(text[text.index(after: comma)...]) }
        guard let data = Data(base64Encoded: text, options: .ignoreUnknownCharacters) else {
            call.reject("That image couldn't be read.")
            return nil
        }
        return data
    }

    @objc func save(_ call: CAPPluginCall) {
        guard let data = imageData(call) else { return }
        // "Add only" access: the app can add pictures but never sees the rest of the library.
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                call.reject("Allow treehouse to add photos in Settings to save images.", "PERMISSION_DENIED")
                return
            }
            PHPhotoLibrary.shared().performChanges({
                PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil)
            }) { ok, error in
                if ok { call.resolve(["saved": true]) } else { call.reject("Couldn't save the image.", nil, error) }
            }
        }
    }

    @objc func share(_ call: CAPPluginCall) {
        guard let data = imageData(call) else { return }
        guard let image = UIImage(data: data) else { call.reject("That image couldn't be read."); return }
        var items: [Any] = [image]
        if let text = call.getString("text"), !text.isEmpty { items.append(text) }
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController else { call.reject("Couldn't open the share sheet."); return }
            let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
            if let popover = sheet.popoverPresentationController {   // iPad: anchor it to the middle of the screen
                popover.sourceView = host.view
                popover.sourceRect = CGRect(x: host.view.bounds.midX, y: host.view.bounds.midY, width: 0, height: 0)
                popover.permittedArrowDirections = []
            }
            host.present(sheet, animated: true) { call.resolve(["shared": true]) }
        }
    }
}

/// The app's main screen: Capacitor's web view, plus the app's own plugin.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(TreehouseImagePlugin())
    }
}
