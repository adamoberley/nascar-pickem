import SwiftUI

struct PlayerTabView: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @EnvironmentObject private var viewModel: PlayerViewModel

    var body: some View {
        TabView {
            HomeView()
                .tabItem {
                    Label("Home", systemImage: "house.fill")
                }

            PicksView()
                .tabItem {
                    Label("Picks", systemImage: "checklist")
                }

            StandingsView()
                .tabItem {
                    Label("Standings", systemImage: "list.number")
                }

            RaceView()
                .tabItem {
                    Label("Race", systemImage: "flag.checkered")
                }
        }
        .overlay(alignment: .top) {
            leagueHeader
        }
    }

    private var leagueHeader: some View {
        VStack(spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(viewModel.selectedLeague?.name ?? "NASCAR Pick'Em")
                        .font(.headline)
                    Text("Season \(viewModel.selectedLeague?.seasonYear ?? 0)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Menu {
                    ForEach(viewModel.memberships.indices, id: \.self) { index in
                        let pair = viewModel.memberships[index]
                        Button(pair.0.name) {
                            viewModel.applyLeagueSelection(leagueId: pair.0.id)
                        }
                    }

                    Button("Sign Out", role: .destructive) {
                        try? sessionStore.signOut()
                    }
                } label: {
                    Image(systemName: "line.3.horizontal.circle")
                        .font(.title3)
                }
            }
            .padding(.horizontal)
            .padding(.top, 50)
            .padding(.bottom, 8)
            .background(.thinMaterial)

            Spacer()
        }
        .ignoresSafeArea()
    }
}
