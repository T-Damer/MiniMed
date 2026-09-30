import SwiftUI
import shared

@main
struct MiniMedApp: App {
    var body: some Scene {
        WindowGroup {
            NativeContentView().ignoresSafeArea()
        }
    }
}

private struct NativeContentView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController {
        NativeViewControllerKt.nativeViewController()
    }

    func updateUIViewController(_ controller: UIViewController, context: Context) {}
}
