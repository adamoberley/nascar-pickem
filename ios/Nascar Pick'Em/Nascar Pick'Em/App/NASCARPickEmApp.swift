import SwiftUI
import FirebaseCore
import FirebaseAuth
import UserNotifications
import os.log
#if canImport(FirebaseMessaging)
import FirebaseMessaging
#endif

final class PushNotificationCoordinator {
    static let shared = PushNotificationCoordinator()

    private let logger = Logger(subsystem: "com.nascar.pickem", category: "PushNotifications")
    private let repository = LeagueRepository.shared
    private let defaults = UserDefaults.standard
    private let deviceIdKey = "push.device.id"

    private var currentToken: String?
    private var lastSyncedKey: String?

    private init() { }

    func configure(application: UIApplication) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { [weak self] granted, error in
            if let error {
                self?.logger.error("Push auth request failed: \(error.localizedDescription, privacy: .public)")
                return
            }
            guard granted else {
                self?.logger.info("Push permission not granted")
                return
            }
            DispatchQueue.main.async {
                application.registerForRemoteNotifications()
            }
        }
    }

    func handleAuthStateChange(user: User?) {
        if user == nil {
            lastSyncedKey = nil
        }
        syncTokenIfPossible()
    }

    func handleWillSignOut() {
        guard let token = currentToken else { return }
        repository.removePushToken(token: token, deviceId: deviceId) { [weak self] result in
            if case let .failure(error) = result {
                self?.logger.error("Failed to remove push token before sign-out: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    func handleFCMToken(token: String?) {
        guard let token else { return }
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        currentToken = trimmed
        syncTokenIfPossible()
    }

    private var deviceId: String {
        if let existing = defaults.string(forKey: deviceIdKey), !existing.isEmpty {
            return existing
        }
        let generated = UUID().uuidString.lowercased()
        defaults.set(generated, forKey: deviceIdKey)
        return generated
    }

    private func syncTokenIfPossible() {
        guard let userId = Auth.auth().currentUser?.uid,
              let token = currentToken,
              !token.isEmpty else {
            return
        }
        let syncKey = "\(userId)::\(token)"
        if lastSyncedKey == syncKey { return }
        repository.upsertPushToken(token: token, deviceId: deviceId, platform: "ios") { [weak self] result in
            switch result {
            case .success:
                self?.lastSyncedKey = syncKey
            case .failure(let error):
                self?.logger.error("Failed to sync push token: \(error.localizedDescription, privacy: .public)")
            }
        }
    }
}

class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        FirebaseApp.configure()
        UNUserNotificationCenter.current().delegate = self
        PushNotificationCoordinator.shared.configure(application: application)
#if canImport(FirebaseMessaging)
        Messaging.messaging().delegate = self
        Messaging.messaging().token { token, error in
            if let error {
                Logger(subsystem: "com.nascar.pickem", category: "PushNotifications")
                    .error("Initial FCM token fetch failed: \(error.localizedDescription, privacy: .public)")
                return
            }
            PushNotificationCoordinator.shared.handleFCMToken(token: token)
        }
#endif
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
#if canImport(FirebaseMessaging)
        Messaging.messaging().apnsToken = deviceToken
#endif
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Logger(subsystem: "com.nascar.pickem", category: "PushNotifications")
            .error("APNs registration failed: \(error.localizedDescription, privacy: .public)")
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .badge])
    }
}

#if canImport(FirebaseMessaging)
extension AppDelegate: MessagingDelegate {
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        PushNotificationCoordinator.shared.handleFCMToken(token: fcmToken)
    }
}
#endif

@main
struct NASCARPickEmApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var sessionStore = SessionStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(sessionStore)
        }
    }
}
