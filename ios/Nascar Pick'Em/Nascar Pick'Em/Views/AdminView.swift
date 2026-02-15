import SwiftUI

struct AdminView: View {
    @EnvironmentObject private var viewModel: PlayerViewModel
    @Environment(\.colorScheme) private var colorScheme

    @State private var name: String = ""
    @State private var seasonYear: Int = Calendar.current.component(.year, from: Date())
    @State private var payoutConfigText: String = ""
    @State private var adminBusy = false
    @State private var adminMessage: String?
    @State private var adminError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    leagueSettingsSection
                    refreshDataSection
                    if let adminMessage {
                        Text(adminMessage)
                            .font(NASCARTheme.textFont(size: 15))
                            .foregroundStyle(.green)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .appCard(padding: 14)
                    }
                    if let adminError {
                        Text(adminError)
                            .font(NASCARTheme.textFont(size: 15))
                            .foregroundStyle(NASCARTheme.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .appCard(padding: 14)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 60)
                .padding(.bottom, 12)
            }
            .appScreenBackground()
            .toolbar(.hidden, for: .navigationBar)
            .onAppear {
                syncFromLeague()
            }
            .onChange(of: viewModel.selectedLeague?.id) { _, _ in
                syncFromLeague()
            }
            .onChange(of: viewModel.selectedLeague?.name) { _, _ in
                syncFromLeague()
            }
        }
    }

    private var leagueSettingsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("League Settings")
                .font(NASCARTheme.displayFont(size: 20, weight: .bold))
                .textCase(.uppercase)
            VStack(alignment: .leading, spacing: 8) {
                Text("League Name")
                    .font(NASCARTheme.textFont(size: 13, weight: .semibold))
                    .foregroundStyle(.secondary)
                TextField("League Name", text: $name)
                    .textFieldStyle(.plain)
                    .appInputField()
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("Season Year")
                    .font(NASCARTheme.textFont(size: 13, weight: .semibold))
                    .foregroundStyle(.secondary)
                TextField("Season Year", value: $seasonYear, format: .number)
                    .keyboardType(.numberPad)
                    .textFieldStyle(.plain)
                    .appInputField()
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("Payout Notes (Optional)")
                    .font(NASCARTheme.textFont(size: 13, weight: .semibold))
                    .foregroundStyle(.secondary)
                TextField("e.g. 1st: $1,000 · 2nd: $250", text: $payoutConfigText, axis: .vertical)
                    .lineLimit(3...6)
                    .textFieldStyle(.plain)
                    .appInputField()
            }
            Button {
                adminMessage = nil
                adminError = nil
                adminBusy = true
                viewModel.setLeagueSettings(name: name, seasonYear: seasonYear, payoutConfigText: payoutConfigText) { result in
                    adminBusy = false
                    switch result {
                    case .success:
                        adminMessage = "League settings saved."
                        adminError = nil
                    case .failure(let error):
                        adminError = error.localizedDescription
                        adminMessage = nil
                    }
                }
            } label: {
                Text("Save Settings")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(BrandPrimaryButtonStyle())
            .disabled(adminBusy)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .appCard()
    }

    private var refreshDataSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Data")
                .font(NASCARTheme.displayFont(size: 20, weight: .bold))
                .textCase(.uppercase)
            Text("Refresh schedule and standings from NASCAR. Run this after new races or when tiers are missing.")
                .font(NASCARTheme.textFont(size: 14))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                adminMessage = nil
                adminError = nil
                adminBusy = true
                viewModel.runManualRefresh { result in
                    adminBusy = false
                    switch result {
                    case .success:
                        adminMessage = "Refresh started. Data may take a moment to update."
                        adminError = nil
                    case .failure(let error):
                        adminError = error.localizedDescription
                        adminMessage = nil
                    }
                }
            } label: {
                Text("Refresh data")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(BrandSecondaryButtonStyle())
            .disabled(adminBusy)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .appCard()
    }

    private func syncFromLeague() {
        guard let league = viewModel.selectedLeague else { return }
        name = league.name
        seasonYear = league.seasonYear
        payoutConfigText = league.payoutConfigText
    }
}
