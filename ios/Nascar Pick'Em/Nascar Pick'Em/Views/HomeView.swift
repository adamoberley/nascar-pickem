import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var viewModel: PlayerViewModel
    @Environment(\.colorScheme) private var colorScheme
    @Binding var selectedTab: Int

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    if let upcomingRace = viewModel.upcomingRace {
                        VStack(alignment: .leading, spacing: 4) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(upcomingRace.name)
                                    .font(NASCARTheme.raceNameFont(size: 28, weight: .bold))
                                    .textCase(.uppercase)
                                Text(upcomingRace.track)
                                    .font(NASCARTheme.textFont(size: 16))
                                    .foregroundStyle(.secondary)
                                Text("\(upcomingRace.startTime.formatted(date: .abbreviated, time: .omitted)) – \(upcomingRace.startTime.formatted(date: .omitted, time: .shortened))\(upcomingRace.tvChannel.map { " · \($0)" } ?? "")")
                                    .font(NASCARTheme.textFont(size: 15))
                                lockCountdown(lockDate: upcomingRace.lockTime)
                                    .padding(.top, 8)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .appCard()

                        Button {
                            selectedTab = 1
                        } label: {
                            VStack(alignment: .leading, spacing: 10) {
                                HStack {
                                    Text("Your Picks")
                                        .font(NASCARTheme.displayFont(size: 24, weight: .bold))
                                        .textCase(.uppercase)
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(NASCARTheme.textFont(size: 14, weight: .semibold))
                                        .foregroundStyle(.secondary)
                                        .padding(.trailing, 16)
                                }
                                if let pick = viewModel.currentPick, !pick.tierA.isEmpty || !pick.tierB.isEmpty || !pick.tierC.isEmpty {
                                    if !pick.tierA.isEmpty {
                                        picksTierSection(title: "Tier A", limit: 3, driverIds: pick.tierA, tierColor: NASCARTheme.yellow)
                                    }
                                    if !pick.tierB.isEmpty {
                                        picksTierSection(title: "Tier B", limit: 2, driverIds: pick.tierB, tierColor: NASCARTheme.red)
                                    }
                                    if !pick.tierC.isEmpty {
                                        picksTierSection(title: "Tier C", limit: 1, driverIds: pick.tierC, tierColor: NASCARTheme.blue)
                                    }
                                } else {
                                    HStack(spacing: 8) {
                                        Image(systemName: "checklist")
                                            .font(.system(size: 18))
                                            .foregroundStyle(.secondary)
                                        Text("No picks selected — tap to make your picks")
                                            .font(NASCARTheme.textFont(size: 15))
                                            .foregroundStyle(.secondary)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.vertical, 4)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                        .appCard()
                    } else {
                        Text("No upcoming race loaded.")
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .appCard()
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 60)
                .padding(.bottom, 12)
            }
            .appScreenBackground()
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    @ViewBuilder
    private func picksTierSection(title: String, limit: Int, driverIds: [String], tierColor: Color) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title)
                    .font(NASCARTheme.displayFont(size: 20, weight: .bold))
                    .textCase(.uppercase)
                Spacer()
                Text("\(driverIds.count)/\(limit)")
                    .font(NASCARTheme.textFont(size: 14))
                    .foregroundStyle(.secondary)
                    .padding(.trailing, 12)
            }
            VStack(alignment: .leading, spacing: 8) {
                ForEach(driverIds, id: \.self) { driverId in
                    let driver = viewModel.driversById[driverId]
                    HStack(spacing: 6) {
                        Text("#\(driver?.number ?? "--") \(driver?.name ?? driverId)")
                            .font(NASCARTheme.textFont(size: 15, weight: .semibold))
                            .lineLimit(1)
                            .layoutPriority(1)
                        if let team = driver?.team, !team.isEmpty {
                            Text(team)
                                .font(NASCARTheme.textFont(size: 12))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .mask(
                        LinearGradient(
                            stops: [
                                .init(color: .black, location: 0),
                                .init(color: .black, location: 0.82),
                                .init(color: .clear, location: 1)
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .overlay(alignment: .trailing) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 16))
                            .foregroundStyle(tierColor)
                            .padding(.trailing, 2)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(tierColor.opacity(colorScheme == .dark ? 0.2 : 0.12))
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func lockCountdown(lockDate: Date) -> some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            let remaining = max(0, Int(lockDate.timeIntervalSinceNow))
            let hours = remaining / 3600
            let minutes = (remaining % 3600) / 60
            let seconds = remaining % 60
            let days = hours / 24
            let displayHours = hours % 24

            let countdownText: String = {
                if remaining == 0 {
                    return "Locked"
                } else if hours >= 1 {
                    return String(format: "Locks in %dd %dh %02dm", days, displayHours, minutes)
                } else {
                    return String(format: "Locks in %02dm %02ds", minutes, seconds)
                }
            }()

            return Text(countdownText)
                .font(NASCARTheme.textFont(size: 14, weight: .bold))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .foregroundStyle(NASCARTheme.red)
                .background(
                    Capsule()
                        .fill(NASCARTheme.red.opacity(colorScheme == .dark ? 0.2 : 0.13))
                )
        }
    }
}
