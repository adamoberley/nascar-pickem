import SwiftUI
import FirebaseAuth

struct RootView: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @StateObject private var viewModel = PlayerViewModel()

    var body: some View {
        Group {
            if sessionStore.isLoading {
                ProgressView("Loading...")
            } else if sessionStore.user == nil {
                SignInView()
            } else if viewModel.memberships.isEmpty {
                LeagueSetupView()
                    .environmentObject(viewModel)
            } else {
                PlayerTabView()
                    .environmentObject(viewModel)
            }
        }
        .task(id: sessionStore.user?.uid) {
            viewModel.clearMessages()
            if sessionStore.user != nil {
                viewModel.loadMemberships()
            }
        }
        .alert(
            "Error",
            isPresented: Binding(
                get: { viewModel.errorMessage != nil },
                set: { if !$0 { viewModel.errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
    }
}
