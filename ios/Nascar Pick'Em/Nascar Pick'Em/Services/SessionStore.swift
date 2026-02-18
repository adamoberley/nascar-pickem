import Foundation
import Combine
import FirebaseAuth

final class SessionStore: ObservableObject {
    @Published private(set) var user: User?
    @Published private(set) var isLoading: Bool = true

    private var handle: AuthStateDidChangeListenerHandle?

    init() {
        handle = Auth.auth().addStateDidChangeListener { [weak self] _, user in
            self?.user = user
            self?.isLoading = false
            PushNotificationCoordinator.shared.handleAuthStateChange(user: user)
        }
    }

    deinit {
        if let handle {
            Auth.auth().removeStateDidChangeListener(handle)
        }
    }

    func signUp(email: String, password: String, completion: @escaping (Result<Void, Error>) -> Void) {
        Auth.auth().createUser(withEmail: email, password: password) { _, error in
            if let error {
                completion(.failure(error))
                return
            }
            completion(.success(()))
        }
    }

    func signInWithPassword(email: String, password: String, completion: @escaping (Result<Void, Error>) -> Void) {
        Auth.auth().signIn(withEmail: email, password: password) { _, error in
            if let error {
                completion(.failure(error))
                return
            }
            completion(.success(()))
        }
    }

    func signOut() throws {
        PushNotificationCoordinator.shared.handleWillSignOut()
        try Auth.auth().signOut()
        PushNotificationCoordinator.shared.handleAuthStateChange(user: nil)
    }
}
