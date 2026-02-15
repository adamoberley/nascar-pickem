import SwiftUI

struct PlayerTabView: View {
    @EnvironmentObject private var viewModel: PlayerViewModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var selectedTab: Int = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            HomeView(selectedTab: $selectedTab)
                .tabItem {
                    Label("Home", systemImage: "house.fill")
                }
                .tag(0)

            PicksView()
                .tabItem {
                    Label("Picks", systemImage: "checklist")
                }
                .tag(1)

            StandingsView()
                .tabItem {
                    Label("Standings", systemImage: "list.number")
                }
                .tag(2)

            RaceView()
                .tabItem {
                    Label("Race", systemImage: "flag.checkered")
                }
                .tag(3)

            if viewModel.isAdmin {
                AdminView()
                    .tabItem {
                        Label("Admin", systemImage: "gearshape.fill")
                    }
                    .tag(4)
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            HeaderView(title: pageName, showLeagueMenu: true)
                .padding(.horizontal, 14)
                .padding(.top, 8)
                .padding(.bottom, 10)
                .background(alignment: .bottom) {
                    GeometryReader { geo in
                        LinearGradient(
                            colors: [
                                NASCARTheme.secondarySurface(for: colorScheme)
                                    .opacity(colorScheme == .dark ? 0.99 : 0.99),
                                NASCARTheme.secondarySurface(for: colorScheme).opacity(0)
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                        .frame(width: geo.size.width, height: geo.size.height + geo.safeAreaInsets.top + 5)
                    }
                    .ignoresSafeArea(edges: .top)
                }
        }
        .tint(NASCARTheme.red)
        .onChange(of: viewModel.isAdmin) { _, isAdmin in
            if !isAdmin && selectedTab == 4 {
                selectedTab = 0
            }
        }
    }

    private var pageName: String {
        switch selectedTab {
        case 0: return "Home"
        case 1: return "Picks"
        case 2: return "Standings"
        case 3: return "Race"
        case 4: return "Admin"
        default: return "Home"
        }
    }
}
