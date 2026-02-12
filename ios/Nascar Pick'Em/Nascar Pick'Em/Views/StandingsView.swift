import SwiftUI

struct StandingsView: View {
    @EnvironmentObject private var viewModel: PlayerViewModel

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                List {
                    Section("Season Leaderboard") {
                        ForEach(viewModel.seasonScores) { score in
                            Button {
                                viewModel.observeStandingsUser(userId: score.id)
                            } label: {
                                HStack {
                                    Text("#\(score.rank)")
                                        .font(.headline)
                                        .frame(width: 44, alignment: .leading)
                                    Text(viewModel.members.first(where: { $0.id == score.id })?.displayName ?? score.id)
                                    Spacer()
                                    Text("\(score.seasonTotal)")
                                        .bold()
                                }
                            }
                        }
                    }

                    Section("Weekly Breakdown") {
                        ForEach(viewModel.selectedMemberWeeklyScores) { weekly in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(raceName(for: weekly.raceId))
                                    .font(.subheadline.bold())
                                HStack {
                                    Text("\(weekly.weeklyTotal) pts")
                                        .foregroundStyle(.secondary)
                                    if weekly.hasAdjustments {
                                        Text("Adjusted")
                                            .font(.caption2.bold())
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(Color.red.opacity(0.2))
                                            .clipShape(Capsule())
                                    }
                                }
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
            }
            .navigationTitle("Standings")
        }
    }

    private func raceName(for raceId: String) -> String {
        viewModel.races.first(where: { $0.id == raceId })?.name ?? raceId
    }
}
