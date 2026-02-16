import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var viewModel: PlayerViewModel
    @Environment(\.colorScheme) private var colorScheme
    @Binding var selectedTab: Int

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    // Live race section (when race is in progress)
                    if let liveRace = viewModel.effectiveLiveRace {
                        liveRaceCard(liveRace: liveRace)
                        if !viewModel.liveRacePointsDocument.drivers.isEmpty {
                            liveDriverPointsCard
                        }
                        liveStandingsCard
                    }

                    // Primary race card (when not showing live, or below live section)
                    if let primaryRace = viewModel.primaryRace, viewModel.effectiveLiveRace == nil {
                        raceCard(race: primaryRace)
                    }

                    // Your Picks card (uses primary race)
                    if viewModel.primaryRace != nil {
                        yourPicksCard
                    } else if viewModel.effectiveLiveRace == nil {
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

    // MARK: - Live section

    private func liveRaceCard(liveRace: RaceItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text("LIVE")
                    .font(NASCARTheme.textFont(size: 12, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(NASCARTheme.red))
                Text(liveRace.name)
                    .font(NASCARTheme.raceNameFont(size: 28, weight: .bold))
                    .textCase(.uppercase)
            }
            Text(liveRace.track)
                .font(NASCARTheme.textFont(size: 16))
                .foregroundStyle(.secondary)
            if let lap = viewModel.liveRacePointsDocument.liveLapNumber,
               let total = viewModel.liveRacePointsDocument.liveLapsInRace {
                let stageText: String = if let stage = viewModel.liveRacePointsDocument.liveStage {
                    " · Stage \(stage.stageNum) (ends lap \(stage.finishAtLap))"
                } else { "" }
                Text("Lap \(lap)/\(total)\(stageText)")
                    .font(NASCARTheme.textFont(size: 15))
                    .foregroundStyle(.secondary)
            }
            Link(destination: URL(string: "https://www.nascar.com/live-results/nascar-cup-series/\(liveRace.id)/")!) {
                Text("View live leaderboard & stage results on NASCAR.com")
                    .font(NASCARTheme.textFont(size: 14, weight: .semibold))
                    .foregroundStyle(NASCARTheme.blue)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .appCard()
    }

    private var liveDriverPointsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Live driver points")
                .font(NASCARTheme.displayFont(size: 20, weight: .bold))
                .textCase(.uppercase)
            VStack(alignment: .leading, spacing: 6) {
                ForEach(viewModel.liveRacePointsDocument.drivers.sorted { $0.basePoints > $1.basePoints }, id: \.driverId) { entry in
                    HStack {
                        Text(viewModel.driversById[entry.driverId]?.name ?? entry.driverId)
                            .font(NASCARTheme.textFont(size: 15, weight: .semibold))
                            .lineLimit(1)
                        Spacer()
                        Text("\(entry.basePoints)")
                            .font(NASCARTheme.textFont(size: 15, weight: .bold))
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NASCARTheme.secondarySurface(for: colorScheme)))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .appCard()
    }

    private var liveStandingsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Live race standings")
                .font(NASCARTheme.displayFont(size: 20, weight: .bold))
                .textCase(.uppercase)
            if viewModel.liveWeeklyScores.isEmpty {
                Text("No scores yet. Points will update as official results come in.")
                    .font(NASCARTheme.textFont(size: 15))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(Array(viewModel.liveWeeklyScores.enumerated()), id: \.element.id) { index, score in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text("#\(index + 1)")
                                    .font(NASCARTheme.textFont(size: 15, weight: .bold))
                                    .frame(width: 28, alignment: .leading)
                                Text(viewModel.members.first(where: { $0.id == score.userId })?.displayName ?? score.userId)
                                    .font(NASCARTheme.textFont(size: 15, weight: .semibold))
                                    .lineLimit(1)
                                Spacer()
                                Text("\(score.weeklyTotal)")
                                    .font(NASCARTheme.textFont(size: 15, weight: .bold))
                            }
                            ForEach(score.breakdown.sorted { $0.finalPointsApplied > $1.finalPointsApplied }) { item in
                                HStack {
                                    Text(viewModel.driversById[item.driverId]?.name ?? item.driverId)
                                        .font(NASCARTheme.textFont(size: 13))
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                    Spacer()
                                    Text("\(item.finalPointsApplied)")
                                        .font(NASCARTheme.textFont(size: 13, weight: .semibold))
                                }
                                .padding(.leading, 36)
                            }
                        }
                        .padding(10)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NASCARTheme.secondarySurface(for: colorScheme)))
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .appCard()
    }

    private func raceCard(race: RaceItem) -> some View {
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
    }

    private var yourPicksCard: some View {
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
                        picksTierSection(title: "Tier A", limit: 3, driverIds: pick.tierA, tierColor: NASCARTheme.yellow, positionByDriverId: viewModel.driverPositionByDriverId)
                    }
                    if !pick.tierB.isEmpty {
                        picksTierSection(title: "Tier B", limit: 2, driverIds: pick.tierB, tierColor: NASCARTheme.red, positionByDriverId: viewModel.driverPositionByDriverId)
                    }
                    if !pick.tierC.isEmpty {
                        picksTierSection(title: "Tier C", limit: 1, driverIds: pick.tierC, tierColor: NASCARTheme.blue, positionByDriverId: viewModel.driverPositionByDriverId)
                    }
                } else {
                    HStack(spacing: 8) {
                        Image(systemName: "checklist")
                            .font(.system(size: 18))
                            .foregroundStyle(.secondary)
                        Text(viewModel.effectiveLiveRace != nil ? "No picks for this race." : "No picks selected — tap to make your picks")
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
    }

    @ViewBuilder
    private func picksTierSection(title: String, limit: Int, driverIds: [String], tierColor: Color, positionByDriverId: [String: Int] = [:]) -> some View {
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
                    let runningPosition = positionByDriverId[driverId]
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
                        } else {
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
                            .fill(tierColor.opacity(colorScheme == .dark ? 0.2 : 0.12))
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
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
