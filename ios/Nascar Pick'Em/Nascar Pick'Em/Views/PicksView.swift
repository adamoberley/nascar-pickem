import SwiftUI

struct PicksView: View {
    @EnvironmentObject private var viewModel: PlayerViewModel
    @Environment(\.colorScheme) private var colorScheme

    @State private var tierA: [String] = []
    @State private var tierB: [String] = []
    @State private var tierC: [String] = []
    @State private var localError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    if let race = viewModel.primaryRace {
                        VStack(alignment: .leading, spacing: 4) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(race.name)
                                    .font(NASCARTheme.raceNameFont(size: 28, weight: .bold))
                                    .textCase(.uppercase)
                                Text(race.track)
                                    .font(NASCARTheme.textFont(size: 16))
                                    .foregroundStyle(.secondary)
                                Text("\(race.startTime.formatted(date: .abbreviated, time: .omitted)) – \(race.startTime.formatted(date: .omitted, time: .shortened))\(race.tvChannel.map { " · \($0)" } ?? "")")
                                    .font(NASCARTheme.textFont(size: 15))
                                lockCountdown(lockDate: race.lockTime)
                                    .padding(.top, 8)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .appCard()

                        if let tier = viewModel.effectiveTier {
                            tierSection(title: "Tier A", limit: 3, drivers: tier.tierA + tierA.filter { !tier.tierA.contains($0) }, selected: tierA, tierColor: NASCARTheme.yellow, disabled: viewModel.isPickLocked)
                            tierSection(title: "Tier B", limit: 2, drivers: tier.tierB + tierB.filter { !tier.tierB.contains($0) }, selected: tierB, tierColor: NASCARTheme.red, disabled: viewModel.isPickLocked)
                            tierSection(title: "Tier C", limit: 1, drivers: tier.tierC + tierC.filter { !tier.tierC.contains($0) }, selected: tierC, tierColor: NASCARTheme.blue, disabled: viewModel.isPickLocked)

                            if let localError {
                                Text(localError)
                                    .font(NASCARTheme.textFont(size: 13))
                                    .foregroundStyle(NASCARTheme.red)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .appCard(padding: 14)
                            }

                            if viewModel.isSavingPick {
                                Text("Saving…")
                                    .font(NASCARTheme.textFont(size: 13))
                                    .foregroundStyle(.secondary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .appCard(padding: 14)
                            } else if let statusMessage = viewModel.statusMessage {
                                Text(statusMessage)
                                    .font(NASCARTheme.textFont(size: 13))
                                    .foregroundStyle(.green)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .appCard(padding: 14)
                            }

                            if viewModel.isPickLocked {
                                Text("Picks are locked for this race. You can no longer edit them.")
                                    .font(NASCARTheme.textFont(size: 15))
                                    .foregroundStyle(.secondary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .appCard(padding: 14)
                            } else {
                                Button {
                                    viewModel.clearMessages()
                                    viewModel.savePick(tierA: tierA, tierB: tierB, tierC: tierC)
                                } label: {
                                    Text("Save picks")
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 12)
                                }
                                .buttonStyle(BrandPrimaryButtonStyle())
                                .disabled(viewModel.isSavingPick || tierA.count != 3 || tierB.count != 2 || tierC.count != 1 || Set(tierA + tierB + tierC).count != 6)
                            }
                        } else {
                            Text("Tiers are not available yet. Run \"Refresh data\" in Admin to load schedule and standings.")
                                .font(NASCARTheme.textFont(size: 15))
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .appCard()
                        }
                    } else {
                        Text("No scheduled race available.")
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
            .onAppear {
                applyCurrentPick()
            }
            .onChange(of: viewModel.currentPick?.raceId) { _, _ in
                applyCurrentPick()
            }
            .onChange(of: viewModel.currentPick) { _, _ in
                if tierA.isEmpty, tierB.isEmpty, tierC.isEmpty {
                    applyCurrentPick()
                }
            }
        }
    }

    @ViewBuilder
    private func tierSection(
        title: String,
        limit: Int,
        drivers: [String],
        selected: [String],
        tierColor: Color,
        disabled: Bool = false
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title)
                    .font(NASCARTheme.displayFont(size: 20, weight: .bold))
                    .textCase(.uppercase)
                Spacer()
                Text("\(selected.count)/\(limit)")
                    .font(NASCARTheme.textFont(size: 14))
                    .foregroundStyle(.secondary)
                    .padding(.trailing, 12)
            }
            VStack(alignment: .leading, spacing: 8) {
                ForEach(drivers, id: \.self) { driverId in
                    let driver = viewModel.driversById[driverId]
                    let isSelected = selected.contains(driverId)
                    let runningPosition = viewModel.driverPositionByDriverId[driverId]
                    Button {
                        if !disabled { toggle(driverId: driverId, tierTitle: title, limit: limit) }
                    } label: {
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
                            if let pos = runningPosition {
                                Text("P\(pos)")
                                    .font(NASCARTheme.textFont(size: 13, weight: .bold))
                                    .foregroundStyle(tierColor)
                                    .padding(.trailing, 2)
                            } else if isSelected {
                                Image(systemName: "checkmark.circle.fill")
                                    .font(.system(size: 16))
                                    .foregroundStyle(tierColor)
                                    .padding(.trailing, 2)
                            }
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(
                                    isSelected
                                        ? tierColor.opacity(colorScheme == .dark ? 0.2 : 0.12)
                                        : NASCARTheme.secondarySurface(for: colorScheme)
                                )
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(disabled)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .appCard()
    }

    private func toggle(driverId: String, tierTitle: String, limit: Int) {
        localError = nil

        switch tierTitle {
        case "Tier A":
            if tierA.contains(driverId) {
                tierA.removeAll { $0 == driverId }
            } else if tierA.count < limit {
                tierA.append(driverId)
            }
        case "Tier B":
            if tierB.contains(driverId) {
                tierB.removeAll { $0 == driverId }
            } else if tierB.count < limit {
                tierB.append(driverId)
            }
        default:
            if tierC.contains(driverId) {
                tierC.removeAll { $0 == driverId }
            } else if tierC.count < limit {
                tierC.append(driverId)
            }
        }
    }

    private func applyCurrentPick() {
        tierA = viewModel.currentPick?.tierA ?? []
        tierB = viewModel.currentPick?.tierB ?? []
        tierC = viewModel.currentPick?.tierC ?? []
    }

    @ViewBuilder
    private func lockCountdown(lockDate: Date) -> some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            let remaining = max(0, Int(lockDate.timeIntervalSinceNow))
            if remaining > 0 {
                let hours = remaining / 3600
                let minutes = (remaining % 3600) / 60
                let seconds = remaining % 60
                let days = hours / 24
                let displayHours = hours % 24
                let countdownText = hours >= 1
                    ? String(format: "Locks in %dd %dh %02dm", days, displayHours, minutes)
                    : String(format: "Locks in %02dm %02ds", minutes, seconds)

                Text(countdownText)
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
}
