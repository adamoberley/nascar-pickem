import SwiftUI

struct RaceView: View {
    @EnvironmentObject private var viewModel: PlayerViewModel

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Picker("Race", selection: Binding(
                    get: { viewModel.selectedRaceId ?? viewModel.selectedRace?.id ?? "" },
                    set: { viewModel.setSelectedRace(raceId: $0) }
                )) {
                    ForEach(viewModel.races) { race in
                        Text("W\(race.weekIndex): \(race.name)")
                            .tag(race.id)
                    }
                }
                .pickerStyle(.menu)
                .frame(maxWidth: .infinity, alignment: .leading)

                List {
                    Section("Official Points") {
                        ForEach(viewModel.selectedRacePoints, id: \.0) { driverId, points in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(viewModel.driversById[driverId]?.name ?? driverId)
                                    Text(viewModel.driversById[driverId]?.team ?? "")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text("\(points)")
                                    .bold()
                            }
                        }
                    }

                    Section("Your Picks") {
                        if let raceScore = viewModel.selectedRaceScore {
                            Text("Total: \(raceScore.weeklyTotal) pts")
                                .font(.headline)

                            ForEach(raceScore.breakdown) { item in
                                HStack {
                                    VStack(alignment: .leading) {
                                        Text(viewModel.driversById[item.driverId]?.name ?? item.driverId)
                                        Text("Base \(item.basePoints), Adj \(item.totalAdjustments)")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    VStack(alignment: .trailing) {
                                        Text("\(item.finalPointsApplied)")
                                            .bold()
                                        if item.adjusted {
                                            Text("Adjusted")
                                                .font(.caption2)
                                                .foregroundStyle(.red)
                                        }
                                    }
                                }
                            }
                        } else {
                            Text("No score for this race yet.")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .listStyle(.insetGrouped)
            }
            .padding()
            .navigationTitle("Race")
        }
    }
}
