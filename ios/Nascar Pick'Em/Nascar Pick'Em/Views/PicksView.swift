import SwiftUI

struct PicksView: View {
    @EnvironmentObject private var viewModel: PlayerViewModel

    @State private var tierA: [String] = []
    @State private var tierB: [String] = []
    @State private var tierC: [String] = []
    @State private var localError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    if let race = viewModel.upcomingRace {
                        GroupBox("Race") {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(race.name)
                                    .font(.headline)
                                Text(race.track)
                                    .foregroundStyle(.secondary)
                                Text(race.startTime, style: .date)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        if let tier = viewModel.tier {
                            tierSection(title: "Tier A", limit: 3, drivers: tier.tierA, selected: tierA)
                            tierSection(title: "Tier B", limit: 2, drivers: tier.tierB, selected: tierB)
                            tierSection(title: "Tier C", limit: 1, drivers: tier.tierC, selected: tierC)

                            Button(viewModel.isPickLocked ? "Picks Locked" : "Save Picks") {
                                savePick()
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(viewModel.isPickLocked)

                            if let localError {
                                Text(localError)
                                    .font(.footnote)
                                    .foregroundStyle(.red)
                            }

                            if let statusMessage = viewModel.statusMessage {
                                Text(statusMessage)
                                    .font(.footnote)
                                    .foregroundStyle(.green)
                            }
                        } else {
                            Text("Tiers are not available yet.")
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        Text("No scheduled race available.")
                    }
                }
                .padding()
            }
            .navigationTitle("Picks")
            .onAppear {
                applyCurrentPick()
            }
            .onChange(of: viewModel.currentPick?.raceId) { _, _ in
                applyCurrentPick()
            }
        }
    }

    @ViewBuilder
    private func tierSection(
        title: String,
        limit: Int,
        drivers: [String],
        selected: [String]
    ) -> some View {
        GroupBox(title) {
            VStack(alignment: .leading, spacing: 8) {
                Text("\(selected.count)/\(limit) selected")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                ForEach(drivers, id: \.self) { driverId in
                    let driver = viewModel.driversById[driverId]
                    Button {
                        toggle(driverId: driverId, tierTitle: title, limit: limit)
                    } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text("#\(driver?.number ?? "--") \(driver?.name ?? driverId)")
                                Text(driver?.team ?? "")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if selected.contains(driverId) {
                                Image(systemName: "checkmark.circle.fill")
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
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

    private func savePick() {
        let allDrivers = tierA + tierB + tierC
        guard Set(allDrivers).count == allDrivers.count else {
            localError = "A driver can only be chosen once across all tiers."
            return
        }

        guard tierA.count == 3, tierB.count == 2, tierC.count == 1 else {
            localError = "Pick exactly 3 Tier A, 2 Tier B, and 1 Tier C drivers."
            return
        }

        viewModel.clearMessages()
        viewModel.savePick(tierA: tierA, tierB: tierB, tierC: tierC)
    }

    private func applyCurrentPick() {
        tierA = viewModel.currentPick?.tierA ?? []
        tierB = viewModel.currentPick?.tierB ?? []
        tierC = viewModel.currentPick?.tierC ?? []
    }
}
