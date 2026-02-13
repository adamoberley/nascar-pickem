import SwiftUI

struct RaceView: View {
    @EnvironmentObject private var viewModel: PlayerViewModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var showingRacePicker = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    if let race = viewModel.selectedRace {
                        Button {
                            showingRacePicker = true
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                VStack(alignment: .leading, spacing: 1) {
                                    HStack(spacing: 8) {
                                        Text(race.name)
                                            .font(NASCARTheme.raceNameFont(size: 28, weight: .bold))
                                            .textCase(.uppercase)
                                            .foregroundStyle(.primary)
                                        Image(systemName: "chevron.down")
                                            .font(NASCARTheme.textFont(size: 14, weight: .semibold))
                                            .foregroundStyle(.secondary)
                                    }
                                    Text(race.track)
                                            .font(NASCARTheme.textFont(size: 16))
                                            .foregroundStyle(.secondary)
                                        Text("\(race.startTime.formatted(date: .abbreviated, time: .omitted)) – \(race.startTime.formatted(date: .omitted, time: .shortened))\(race.tvChannel.map { " · \($0)" } ?? "")")
                                            .font(NASCARTheme.textFont(size: 15))
                                        lockCountdown(lockDate: race.lockTime, isPast: race.status == .locked || race.status == .completed)
                                            .padding(.top, 8)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        .buttonStyle(.plain)
                        .appCard()
                    } else {
                        Button {
                            showingRacePicker = true
                        } label: {
                            HStack {
                                Text("Select a race")
                                    .font(NASCARTheme.textFont(size: 16))
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(NASCARTheme.textFont(size: 14))
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.plain)
                        .appCard()
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        HStack(alignment: .center) {
                            Text("Your Picks")
                                .font(NASCARTheme.displayFont(size: 24, weight: .bold))
                                .textCase(.uppercase)
                            Spacer(minLength: 12)
                            if let raceScore = viewModel.selectedRaceScore {
                                HStack(spacing: 6) {
                                    Text("Total")
                                        .font(NASCARTheme.textFont(size: 15))
                                        .foregroundStyle(.secondary)
                                    Text("\(raceScore.weeklyTotal)")
                                        .font(NASCARTheme.textFont(size: 15, weight: .bold))
                                        .foregroundStyle(.primary)
                                }
                                .frame(minWidth: 44, alignment: .trailing)
                                .padding(.trailing, 10)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)

                        if let raceScore = viewModel.selectedRaceScore {
                            VStack(alignment: .leading, spacing: 8) {
                                ForEach(raceScore.breakdown) { item in
                                    let tierColor = tierColor(for: item.driverId)
                                    HStack(spacing: 6) {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(viewModel.driversById[item.driverId]?.name ?? item.driverId)
                                                .font(NASCARTheme.textFont(size: 15, weight: .semibold))
                                            Text("Base \(item.basePoints), Adj \(item.totalAdjustments)")
                                                .font(NASCARTheme.textFont(size: 12))
                                                .foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        VStack(alignment: .trailing, spacing: 2) {
                                            Text("\(item.finalPointsApplied)")
                                                .font(NASCARTheme.textFont(size: 15, weight: .bold))
                                            if item.adjusted {
                                                Text("Adjusted")
                                                    .font(NASCARTheme.textFont(size: 11, weight: .bold))
                                                    .foregroundStyle(NASCARTheme.red)
                                            }
                                        }
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 4)
                                    .background(
                                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                                            .fill(tierColor.opacity(colorScheme == .dark ? 0.2 : 0.12))
                                    )
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        } else if let race = viewModel.selectedRace,
                                  (race.status == .scheduled && race.lockTime.timeIntervalSinceNow > 0) {
                            Text("You can make your picks the week of the race.")
                                .font(NASCARTheme.textFont(size: 15))
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        } else {
                            Text("No score for this race yet.")
                                .font(NASCARTheme.textFont(size: 15))
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .appCard()

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Results")
                            .font(NASCARTheme.displayFont(size: 24, weight: .bold))
                            .textCase(.uppercase)
                        if viewModel.selectedRacePoints.isEmpty {
                            Text("No official points loaded yet.")
                                .font(NASCARTheme.textFont(size: 15))
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        } else {
                            VStack(alignment: .leading, spacing: 8) {
                                ForEach(viewModel.selectedRacePoints, id: \.0) { driverId, points in
                                    HStack {
                                        VStack(alignment: .leading) {
                                            Text(viewModel.driversById[driverId]?.name ?? driverId)
                                                .font(NASCARTheme.textFont(size: 15, weight: .semibold))
                                            Text(viewModel.driversById[driverId]?.team ?? "")
                                                .font(NASCARTheme.textFont(size: 12))
                                                .foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Text("\(points)")
                                            .font(NASCARTheme.textFont(size: 15, weight: .bold))
                                    }
                                    .padding(.vertical, 2)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .appCard()
                }
                .padding(.horizontal, 16)
                .padding(.top, 60)
                .padding(.bottom, 12)
            }
            .appScreenBackground()
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $showingRacePicker) {
                racePickerSheet
            }
        }
    }

    private var racePickerSheet: some View {
        NavigationStack {
            List {
                ForEach(viewModel.races) { race in
                    Button {
                        viewModel.setSelectedRace(raceId: race.id)
                        showingRacePicker = false
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(race.name)
                                    .font(NASCARTheme.raceNameFont(size: 17, weight: .semibold))
                                    .foregroundStyle(.primary)
                                Text("\(race.startTime.formatted(date: .abbreviated, time: .omitted)) · \(race.track)")
                                    .font(NASCARTheme.textFont(size: 13))
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if viewModel.selectedRaceId == race.id {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(.primary)
                            }
                        }
                    }
                    .tint(.primary)
                }
            }
            .navigationTitle("Select Race")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        showingRacePicker = false
                    }
                    .foregroundStyle(.primary)
                }
            }
            .tint(.primary)
        }
    }

    private func tierColor(for driverId: String) -> Color {
        guard let pick = viewModel.selectedRacePick else { return NASCARTheme.blue }
        if pick.tierA.contains(driverId) { return NASCARTheme.yellow }
        if pick.tierB.contains(driverId) { return NASCARTheme.red }
        if pick.tierC.contains(driverId) { return NASCARTheme.blue }
        return NASCARTheme.blue
    }

    private func lockCountdown(lockDate: Date, isPast: Bool) -> some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            let remaining = max(0, Int(lockDate.timeIntervalSinceNow))
            let hours = remaining / 3600
            let minutes = (remaining % 3600) / 60
            let seconds = remaining % 60
            let days = hours / 24
            let displayHours = hours % 24

            let countdownText: String = {
                if isPast || remaining == 0 {
                    return "Locked"
                } else if hours >= 1 {
                    return String(format: "Locks in %dd %dh %dm", days, displayHours, minutes)
                } else {
                    return String(format: "Locks in %dm %ds", minutes, seconds)
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
