import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var viewModel: PlayerViewModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if let upcomingRace = viewModel.upcomingRace {
                        GroupBox("Next Race") {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(upcomingRace.name)
                                    .font(.title3.bold())
                                Text(upcomingRace.track)
                                    .foregroundStyle(.secondary)
                                Text(upcomingRace.startTime, style: .date)
                                Text(upcomingRace.startTime, style: .time)
                                lockCountdown(lockDate: upcomingRace.lockTime)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        GroupBox("Pick Status") {
                            if viewModel.currentPick != nil {
                                Label("Picks saved", systemImage: "checkmark.circle.fill")
                                    .foregroundStyle(.green)
                            } else {
                                Label("No picks saved yet", systemImage: "exclamationmark.circle")
                                    .foregroundStyle(.orange)
                            }
                        }
                    } else {
                        Text("No upcoming race loaded.")
                    }

                    if let payout = viewModel.selectedLeague?.payoutConfigText, !payout.isEmpty {
                        GroupBox("Payout Notes") {
                            Text(payout)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }

                    if viewModel.selectedMember?.role == .admin {
                        GroupBox("Invite Code") {
                            Text(viewModel.selectedLeague?.inviteCode ?? "")
                                .font(.title3.monospacedDigit())
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("Home")
        }
    }

    private func lockCountdown(lockDate: Date) -> some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            let remaining = max(0, Int(lockDate.timeIntervalSinceNow))
            let hours = remaining / 3600
            let minutes = (remaining % 3600) / 60
            let seconds = remaining % 60

            Text(
                remaining == 0
                    ? "Locked"
                    : String(format: "Locks in %02dh %02dm %02ds", hours, minutes, seconds)
            )
            .font(.subheadline.bold())
            .foregroundStyle(remaining == 0 ? .red : .blue)
        }
    }
}
