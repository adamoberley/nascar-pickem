import SwiftUI
import UIKit
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
        .tint(NASCARTheme.red)
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

enum NASCARTheme {
    static let black = Color(red: 16 / 255, green: 24 / 255, blue: 32 / 255)
    static let white = Color(red: 250 / 255, green: 250 / 255, blue: 250 / 255)
    static let red = Color(red: 228 / 255, green: 0 / 255, blue: 43 / 255)
    static let blue = Color(red: 0 / 255, green: 94 / 255, blue: 184 / 255)
    static let yellow = Color(red: 243 / 255, green: 208 / 255, blue: 62 / 255)

    static func screenGradient(for scheme: ColorScheme) -> LinearGradient {
        if scheme == .dark {
            return LinearGradient(
                colors: [
                    Color.black,
                    Color.black
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }

        return LinearGradient(
            colors: [
                Color(red: 246 / 255, green: 248 / 255, blue: 250 / 255),
                Color(red: 238 / 255, green: 242 / 255, blue: 246 / 255)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    static func surface(for scheme: ColorScheme) -> Color {
        scheme == .dark
            ? Color(red: 10 / 255, green: 10 / 255, blue: 10 / 255)
            : Color.white
    }

    static func secondarySurface(for scheme: ColorScheme) -> Color {
        scheme == .dark
            ? Color(red: 17 / 255, green: 17 / 255, blue: 17 / 255)
            : Color(red: 244 / 255, green: 246 / 255, blue: 249 / 255)
    }

    static func border(for scheme: ColorScheme) -> Color {
        scheme == .dark
            ? Color.white.opacity(0.18)
            : black.opacity(0.14)
    }

    static func fieldBackground(for scheme: ColorScheme) -> Color {
        scheme == .dark
            ? Color(red: 13 / 255, green: 13 / 255, blue: 13 / 255)
            : white
    }

    static func displayFont(size: CGFloat, weight: Font.Weight = .bold) -> Font {
        // Try Racer Italic first (primary display font)
        let racerCandidates = ["Racer-Italic", "RacerItalic", "Racer Italic"]
        if let racerName = racerCandidates.first(where: { UIFont(name: $0, size: size) != nil }) {
            return .custom(racerName, size: size)
        }
        
        // Fallback to Stainless fonts if Racer Italic not found
        let candidates: [String]
        switch weight {
        case .black, .heavy:
            candidates = ["Stainless-Black", "StainlessCond-Black", "Stainless-Bold"]
        case .bold, .semibold:
            candidates = ["Stainless-Bold", "StainlessCond-Bold", "StainlessCond-Regular"]
        default:
            candidates = ["Stainless-Regular", "StainlessCond-Regular"]
        }

        if let name = candidates.first(where: { UIFont(name: $0, size: size) != nil }) {
            return .custom(name, size: size)
        }

        return .system(size: size, weight: weight, design: .default)
    }

    static func raceNameFont(size: CGFloat, weight: Font.Weight = .bold) -> Font {
        // Use Stainless fonts directly for race names (RacerItalic doesn't support numbers)
        let candidates: [String]
        switch weight {
        case .black, .heavy:
            candidates = ["Stainless-Black", "StainlessCond-Black", "Stainless-Bold"]
        case .bold, .semibold:
            candidates = ["Stainless-Bold", "StainlessCond-Bold", "StainlessCond-Regular"]
        default:
            candidates = ["Stainless-Regular", "StainlessCond-Regular"]
        }

        if let name = candidates.first(where: { UIFont(name: $0, size: size) != nil }) {
            return .custom(name, size: size)
        }

        return .system(size: size, weight: weight, design: .default)
    }

    static func textFont(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        let candidates = weight == .bold || weight == .semibold
            ? ["Neutraface2Text-Bold"]
            : ["Neutraface2Text-Regular", "Neutraface2Text-Book"]

        if let name = candidates.first(where: { UIFont(name: $0, size: size) != nil }) {
            return .custom(name, size: size)
        }

        return .system(size: size, weight: weight, design: .default)
    }
}

struct AppCardModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    let padding: CGFloat

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(NASCARTheme.surface(for: colorScheme))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(NASCARTheme.border(for: colorScheme), lineWidth: 1)
            )
            .shadow(
                color: Color.black.opacity(colorScheme == .dark ? 0.36 : 0.1),
                radius: colorScheme == .dark ? 18 : 12,
                y: 8
            )
    }
}

struct AppScreenBackgroundModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .background {
                NASCARTheme.screenGradient(for: colorScheme)
                    .ignoresSafeArea()
            }
    }
}

struct AppInputFieldModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .background(NASCARTheme.fieldBackground(for: colorScheme))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(NASCARTheme.border(for: colorScheme), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

struct BrandPrimaryButtonStyle: ButtonStyle {
    @Environment(\.colorScheme) private var colorScheme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(NASCARTheme.textFont(size: 17, weight: .bold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 9)
            .background(NASCARTheme.red)
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.white.opacity(colorScheme == .dark ? 0.18 : 0.1), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.99 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .shadow(
                color: NASCARTheme.red.opacity(colorScheme == .dark ? 0.42 : 0.25),
                radius: configuration.isPressed ? 4 : 10,
                y: configuration.isPressed ? 2 : 6
            )
    }
}

/// Compact red button for inline data-op actions (matches web AdminTab).
struct CompactRedButtonStyle: ButtonStyle {
    @Environment(\.colorScheme) private var colorScheme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(NASCARTheme.textFont(size: 13, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(NASCARTheme.red)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .opacity(configuration.isPressed ? 0.9 : 1)
    }
}

struct BrandSecondaryButtonStyle: ButtonStyle {
    @Environment(\.colorScheme) private var colorScheme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(NASCARTheme.textFont(size: 16, weight: .semibold))
            .foregroundStyle(colorScheme == .dark ? NASCARTheme.white : NASCARTheme.blue)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(NASCARTheme.secondarySurface(for: colorScheme))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(
                        NASCARTheme.blue.opacity(colorScheme == .dark ? 0.5 : 0.74),
                        lineWidth: 1.2
                    )
            )
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .opacity(configuration.isPressed ? 0.88 : 1)
    }
}

struct BrandYellowButtonStyle: ButtonStyle {
    @Environment(\.colorScheme) private var colorScheme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(NASCARTheme.textFont(size: 17, weight: .bold))
            .foregroundStyle(NASCARTheme.black)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 9)
            .background(NASCARTheme.yellow)
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.white.opacity(colorScheme == .dark ? 0.18 : 0.1), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.99 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .shadow(
                color: NASCARTheme.yellow.opacity(colorScheme == .dark ? 0.42 : 0.25),
                radius: configuration.isPressed ? 4 : 10,
                y: configuration.isPressed ? 2 : 6
            )
    }
}

extension View {
    func appCard(padding: CGFloat = 16) -> some View {
        modifier(AppCardModifier(padding: padding))
    }

    func appScreenBackground() -> some View {
        modifier(AppScreenBackgroundModifier())
    }

    func appInputField() -> some View {
        modifier(AppInputFieldModifier())
    }
}
