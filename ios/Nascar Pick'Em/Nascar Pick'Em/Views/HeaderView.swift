import SwiftUI

// MARK: - League menu icon (NASCAR stripes)

private let nascarStripeAngle: Double = 15.5

/// Square icon with full NASCAR logo stripe pattern (9 segments):
/// Yellow (1) → clear (0.5) → yellow (1) → clear (1) → red (1.6) → clear (0.5) → red (1.6) → clear (1) → blue (3).
private struct MenuStripesIcon: View {
    private let size: CGFloat = 26
    private static let totalUnits: CGFloat = 1 + 0.5 + 1 + 1 + 1.6 + 0.5 + 1.6 + 1 + 3 // 11.2

    var body: some View {
        let x = size / Self.totalUnits
        HStack(spacing: 0) {
            Rectangle().fill(NASCARTheme.yellow).frame(width: x * 1.0)
            Rectangle().fill(Color.clear).frame(width: x * 0.5)
            Rectangle().fill(NASCARTheme.yellow).frame(width: x * 1.0)
            Rectangle().fill(Color.clear).frame(width: x * 1.0)
            Rectangle().fill(NASCARTheme.red).frame(width: x * 1.6)
            Rectangle().fill(Color.clear).frame(width: x * 0.5)
            Rectangle().fill(NASCARTheme.red).frame(width: x * 1.6)
            Rectangle().fill(Color.clear).frame(width: x * 1.0)
            Rectangle().fill(NASCARTheme.blue).frame(width: x * 3.0)
        }
        .frame(width: size, height: size)
    }
}

// MARK: - League menu trailing (button + dropdown from logo, uses environment)

private struct LeagueMenuTrailing: View {
    @Environment(\.colorScheme) private var colorScheme
    @EnvironmentObject private var sessionStore: SessionStore
    @EnvironmentObject private var viewModel: PlayerViewModel
    @Binding var isMenuOpen: Bool

    private let buttonHeight: CGFloat = 26
    private let menuSpacing: CGFloat = 8

    var body: some View {
        Button {
            isMenuOpen = true
        } label: {
            MenuStripesIcon()
                .frame(height: buttonHeight)
                .rotationEffect(.degrees(isMenuOpen ? nascarStripeAngle : 0))
                .animation(.easeInOut(duration: 0.25), value: isMenuOpen)
        }
        .overlay(alignment: .topTrailing) {
            if isMenuOpen {
                ZStack(alignment: .topTrailing) {
                    Color.clear
                        .contentShape(Rectangle())
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .ignoresSafeArea()
                        .onTapGesture { isMenuOpen = false }

                    menuCard
                        .padding(.top, buttonHeight + menuSpacing)
                }
            }
        }
    }

    @ViewBuilder
    private var menuContent: some View {
        VStack(alignment: .center, spacing: 0) {
            ForEach(viewModel.memberships.indices, id: \.self) { index in
                let pair = viewModel.memberships[index]
                Button {
                    viewModel.applyLeagueSelection(leagueId: pair.0.id)
                    isMenuOpen = false
                } label: {
                    HStack(spacing: 6) {
                        Text(pair.0.name)
                        if pair.0.id == viewModel.selectedLeague?.id {
                            Image(systemName: "checkmark")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(NASCARTheme.red)
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)

                if index < viewModel.memberships.count - 1 {
                    Divider()
                }
            }

            if let payout = viewModel.selectedLeague?.payoutConfigText, !payout.isEmpty {
                Divider()
                VStack(alignment: .leading, spacing: 6) {
                    Text("Payout Notes")
                        .font(NASCARTheme.displayFont(size: 14, weight: .bold))
                        .textCase(.uppercase)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(payout)
                        .font(NASCARTheme.textFont(size: 13))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
            }

            if viewModel.selectedMember?.role == .admin, let code = viewModel.selectedLeague?.inviteCode, !code.isEmpty {
                Divider()
                VStack(alignment: .leading, spacing: 6) {
                    Text("Invite Code")
                        .font(NASCARTheme.displayFont(size: 14, weight: .bold))
                        .textCase(.uppercase)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(code)
                        .font(NASCARTheme.textFont(size: 13))
                        .textCase(.uppercase)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
            }

            Divider()

            Button {
                try? sessionStore.signOut()
                isMenuOpen = false
            } label: {
                Text("Sign Out")
                    .foregroundStyle(.red)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.plain)
        }
    }

    /// Use scrollable menu when payout notes are long so all content is visible; otherwise size to content (no blank space).
    private var needsScrollableMenu: Bool {
        let payout = viewModel.selectedLeague?.payoutConfigText ?? ""
        return payout.count > 120
    }

    private var menuCard: some View {
        Group {
            if needsScrollableMenu {
                ScrollView {
                    menuContent
                }
                .frame(width: 200, height: 330)
            } else {
                menuContent
                    .frame(minWidth: 200, maxHeight: 330)
            }
        }
        .background(NASCARTheme.secondarySurface(for: colorScheme))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(NASCARTheme.border(for: colorScheme), lineWidth: 1)
        )
        .shadow(color: .black.opacity(colorScheme == .dark ? 0.4 : 0.15), radius: 12, x: 0, y: 4)
    }
}

// MARK: - Header

/// Header with NASCAR stripes in front of the title text, matching the official logo look.
/// Stripes are the same height as the letters and use negative spacing to overlap the first character.
/// Use `showLeagueMenu: true` to show the built-in league switcher + sign out menu (one place, all pages).
struct HeaderView: View {
    enum TrailingContent {
        case none
        case leagueMenu
        case custom(AnyView)
    }

    let title: String
    private let trailingContent: TrailingContent

    @State private var isMenuOpen = false

    private let titleFontSize: CGFloat = 34
    private let iconHeight: CGFloat = 26
    private let stripeOverlap: CGFloat = 13.5
    private let iconOffsetY: CGFloat = 3.5
    private let textLeadingOffset: CGFloat = 8

    /// Title only, or title with league menu when `showLeagueMenu` is true.
    init(title: String, showLeagueMenu: Bool = false) {
        self.title = title
        self.trailingContent = showLeagueMenu ? .leagueMenu : .none
    }

    /// Title with custom trailing view.
    init<Trailing: View>(title: String, @ViewBuilder trailing: @escaping () -> Trailing) {
        self.title = title
        self.trailingContent = .custom(AnyView(trailing()))
    }

    var body: some View {
        HStack(alignment: .center, spacing: 0) {
            HStack(alignment: .center, spacing: -stripeOverlap) {
                Image("NASCAR_Icon")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(height: iconHeight)
                    .offset(y: -iconOffsetY)
                    .zIndex(1)

                Text(title)
                    .font(NASCARTheme.displayFont(size: titleFontSize, weight: .bold))
                    .textCase(.uppercase)
                    .lineLimit(1)
                    .padding(.leading, textLeadingOffset)
            }

            Spacer(minLength: 0)

            switch trailingContent {
            case .none:
                EmptyView()
            case .leagueMenu:
                LeagueMenuTrailing(isMenuOpen: $isMenuOpen)
                    .offset(y: -3)
            case .custom(let content):
                content
            }
        }
    }
}

// MARK: - Previews (tweak iconOffsetY & textLeadingOffset above to perfect alignment)

#Preview("Header in app context (HOME)") {
    struct PreviewWrapper: View {
        @Environment(\.colorScheme) private var colorScheme
        var body: some View {
            HeaderView(title: "Home", showLeagueMenu: true)
                .padding(.horizontal, 14)
                .padding(.top, 8)
                .padding(.bottom, 10)
                .background(
                    NASCARTheme.secondarySurface(for: colorScheme)
                        .opacity(colorScheme == .dark ? 0.95 : 0.96)
                )
                .overlay(alignment: .bottom) {
                    Divider()
                        .overlay(NASCARTheme.border(for: colorScheme))
                }
        }
    }
    return PreviewWrapper()
        .environmentObject(SessionStore())
        .environmentObject(PlayerViewModel())
        .background(NASCARTheme.screenGradient(for: .light))
}

#Preview("Header with league menu") {
    HeaderView(title: "Picks", showLeagueMenu: true)
        .padding()
        .environmentObject(SessionStore())
        .environmentObject(PlayerViewModel())
}

#Preview("Header title only") {
    HeaderView(title: "Standings")
        .padding()
}

#Preview("Header with custom trailing") {
    HeaderView(title: "Settings") {
        Image(systemName: "gearshape")
            .font(NASCARTheme.textFont(size: 26, weight: .semibold))
            .foregroundStyle(NASCARTheme.red)
    }
    .padding()
}
