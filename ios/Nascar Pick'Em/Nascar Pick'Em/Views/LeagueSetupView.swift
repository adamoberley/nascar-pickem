import SwiftUI

struct LeagueSetupView: View {
    @EnvironmentObject private var viewModel: PlayerViewModel

    @State private var displayName = ""
    @State private var inviteCode = ""

    @State private var leagueName = ""
    @State private var seasonYear = Calendar.current.component(.year, from: Date())
    @State private var newInviteCode = ""
    @State private var payoutConfigText = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    GroupBox("Join League") {
                        VStack(spacing: 10) {
                            TextField("Display Name", text: $displayName)
                            TextField("Invite Code", text: $inviteCode)
                                .textInputAutocapitalization(.characters)
                            Button("Join") {
                                viewModel.joinLeague(
                                    inviteCode: inviteCode.uppercased(),
                                    displayName: displayName
                                )
                            }
                            .buttonStyle(.borderedProminent)
                        }
                    }

                    GroupBox("Create League (Admin)") {
                        VStack(spacing: 10) {
                            TextField("League Name", text: $leagueName)
                            Stepper("Season Year: \(seasonYear)", value: $seasonYear, in: 2020...2100)
                            TextField("Invite Code", text: $newInviteCode)
                                .textInputAutocapitalization(.characters)
                            TextField("Payout Notes", text: $payoutConfigText, axis: .vertical)
                            Button("Create") {
                                viewModel.createLeague(
                                    name: leagueName,
                                    seasonYear: seasonYear,
                                    inviteCode: newInviteCode.uppercased(),
                                    payoutConfigText: payoutConfigText
                                )
                            }
                            .buttonStyle(.bordered)
                        }
                    }

                    if let statusMessage = viewModel.statusMessage {
                        Text(statusMessage)
                            .font(.footnote)
                            .foregroundStyle(.green)
                    }
                }
                .padding()
            }
            .navigationTitle("League Setup")
        }
    }
}
