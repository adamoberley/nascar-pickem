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

    @State private var leagueSettingsExpanded: Bool = false
    @State private var monitorRaceId: String = ""
    @State private var expandedPickUserId: String?

    @State private var adjustmentRaceId: String = ""
    @State private var adjustmentDriverId: String = ""
    @State private var adjustmentType: String = "penalty"
    @State private var adjustmentDeltaPoints: Int = -10
    @State private var adjustmentReason: String = ""

    private var monitorRaceName: String {
        viewModel.races.first(where: { $0.id == monitorRaceId })?.name ?? "No race"
    }

    private var monitorPicks: [PickItem] {
        viewModel.selectedRacePicks
    }

    private var submittedMembers: [LeagueMember] {
        viewModel.members
            .filter { member in monitorPicks.contains(where: { $0.userId == member.id }) }
            .sorted { $0.displayName < $1.displayName }
    }

    private var missingMembers: [LeagueMember] {
        viewModel.members
            .filter { member in !monitorPicks.contains(where: { $0.userId == member.id }) }
            .sorted { $0.displayName < $1.displayName }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    leagueSettingsSection
                    pickMonitoringSection
                    dataOpsSection
                    adjustmentSection
                    memberPaidStatusSection

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
                seedRaceDefaultsIfNeeded()
            }
            .onChange(of: viewModel.selectedLeague?.id) { _, _ in
                syncFromLeague()
                seedRaceDefaultsIfNeeded()
            }
            .onChange(of: viewModel.selectedLeague?.name) { _, _ in
                syncFromLeague()
            }
            .onChange(of: viewModel.races.count) { _, _ in
                seedRaceDefaultsIfNeeded()
            }
            .onChange(of: monitorRaceId) { _, newValue in
                if !newValue.isEmpty {
                    viewModel.setSelectedRace(raceId: newValue)
                }
            }
        }
    }

    private var leagueSettingsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    leagueSettingsExpanded.toggle()
                }
            } label: {
                HStack {
                    Text("League Settings")
                        .font(NASCARTheme.displayFont(size: 20, weight: .bold))
                        .textCase(.uppercase)
                    Spacer()
                    Image(systemName: leagueSettingsExpanded ? "chevron.up" : "chevron.down")
                        .font(NASCARTheme.textFont(size: 14, weight: .bold))
                        .foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)

            if leagueSettingsExpanded {
                VStack(alignment: .leading, spacing: 8) {
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
                        TextField("Season Year", value: $seasonYear, format: .number.grouping(.never))
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
                            case .failure(let error):
                                adminError = error.localizedDescription
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
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .appCard()
    }

    private var memberPaidStatusSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Member Payments")
                .font(NASCARTheme.displayFont(size: 20, weight: .bold))
                .textCase(.uppercase)
            if viewModel.members.isEmpty {
                Text("No members loaded.")
                    .font(NASCARTheme.textFont(size: 14))
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(viewModel.members.sorted { $0.displayName < $1.displayName }) { member in
                        HStack(spacing: 10) {
                            Text(member.displayName)
                                .font(NASCARTheme.textFont(size: 15, weight: .semibold))
                                .lineLimit(1)
                            Spacer()
                            Text(member.paidStatus == .paid ? "Paid" : "Unpaid")
                                .font(NASCARTheme.textFont(size: 12, weight: .bold))
                                .foregroundStyle(member.paidStatus == .paid ? .green : NASCARTheme.red)
                            Button(member.paidStatus == .paid ? "Mark Unpaid" : "Mark Paid") {
                                adminMessage = nil
                                adminError = nil
                                adminBusy = true
                                let nextStatus: PaidStatus = member.paidStatus == .paid ? .unpaid : .paid
                                viewModel.setMemberPaidStatus(userId: member.id, paidStatus: nextStatus) { result in
                                    adminBusy = false
                                    switch result {
                                    case .success:
                                        adminMessage = "\(member.displayName) marked \(nextStatus.rawValue)."
                                    case .failure(let error):
                                        adminError = error.localizedDescription
                                    }
                                }
                            }
                            .font(NASCARTheme.textFont(size: 12, weight: .semibold))
                            .buttonStyle(.plain)
                            .foregroundStyle(NASCARTheme.blue)
                            .disabled(adminBusy)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NASCARTheme.secondarySurface(for: colorScheme)))
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .appCard()
    }

    private var pickMonitoringSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Pick Monitoring")
                    .font(NASCARTheme.displayFont(size: 20, weight: .bold))
                    .textCase(.uppercase)
                Spacer()
                Text("(\(monitorRaceName))")
                    .font(NASCARTheme.textFont(size: 12))
                    .foregroundStyle(.secondary)
            }

            Picker("Race", selection: $monitorRaceId) {
                Text("Select race").tag("")
                ForEach(viewModel.races) { race in
                    Text(race.name).tag(race.id)
                }
            }
            .pickerStyle(.menu)

            Text("Submitted \(submittedMembers.count)/\(viewModel.members.count) picks")
                .font(NASCARTheme.textFont(size: 14))
                .foregroundStyle(.secondary)

            if !viewModel.canSeeAllPicksForSelectedRace {
                Text("All picks become visible when the race starts.")
                    .font(NASCARTheme.textFont(size: 14))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Submitted")
                        .font(NASCARTheme.textFont(size: 13, weight: .bold))
                        .foregroundStyle(.secondary)
                    if submittedMembers.isEmpty {
                        Text("No submitted picks for this race.")
                            .font(NASCARTheme.textFont(size: 14))
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(submittedMembers) { member in
                            let pick = monitorPicks.first(where: { $0.userId == member.id })
                            let isExpanded = expandedPickUserId == member.id
                            VStack(alignment: .leading, spacing: 6) {
                                Button {
                                    expandedPickUserId = isExpanded ? nil : member.id
                                } label: {
                                    HStack {
                                        Text(member.displayName)
                                            .font(NASCARTheme.textFont(size: 14, weight: .semibold))
                                        Spacer()
                                        Text(isExpanded ? "▼" : "▶")
                                            .font(NASCARTheme.textFont(size: 12, weight: .bold))
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                .buttonStyle(.plain)
                                if isExpanded, let pick {
                                    picksSummary(title: "Tier A", ids: pick.tierA, color: NASCARTheme.yellow)
                                    picksSummary(title: "Tier B", ids: pick.tierB, color: NASCARTheme.red)
                                    picksSummary(title: "Tier C", ids: pick.tierC, color: NASCARTheme.blue)
                                }
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NASCARTheme.secondarySurface(for: colorScheme)))
                        }
                    }
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Missing")
                    .font(NASCARTheme.textFont(size: 13, weight: .bold))
                    .foregroundStyle(.secondary)
                if missingMembers.isEmpty {
                    Text("No missing picks.")
                        .font(NASCARTheme.textFont(size: 14))
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(missingMembers) { member in
                        Text(member.displayName)
                            .font(NASCARTheme.textFont(size: 14))
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .appCard()
    }

    private var dataOpsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Data Operations")
                .font(NASCARTheme.displayFont(size: 20, weight: .bold))
                .textCase(.uppercase)

            HStack(spacing: 10) {
                Button {
                    adminMessage = nil
                    adminError = nil
                    adminBusy = true
                    viewModel.runManualRefresh { result in
                        switch result {
                        case .failure(let error):
                            adminBusy = false
                            adminError = error.localizedDescription
                        case .success:
                            viewModel.syncLiveRaceNow { liveResult in
                                adminBusy = false
                                switch liveResult {
                                case .success(let result):
                                    adminMessage = "Data refresh complete. \(result.message)"
                                case .failure:
                                    adminMessage = "Data refresh complete. Live sync unavailable."
                                }
                            }
                        }
                    }
                } label: {
                    Text("Refresh Data Now")
                }
                .buttonStyle(CompactRedButtonStyle())
                .disabled(adminBusy)

                Button {
                    adminMessage = nil
                    adminError = nil
                    adminBusy = true
                    viewModel.syncLiveRaceNow { result in
                        adminBusy = false
                        switch result {
                        case .success(let sync):
                            adminMessage = sync.message
                        case .failure(let error):
                            adminError = error.localizedDescription
                        }
                    }
                } label: {
                    Text("Sync Live Race")
                }
                .buttonStyle(CompactRedButtonStyle())
                .disabled(adminBusy)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .appCard()
    }

    private var adjustmentSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Add Penalty / Correction")
                .font(NASCARTheme.displayFont(size: 20, weight: .bold))
                .textCase(.uppercase)

            Picker("Race", selection: $adjustmentRaceId) {
                Text("Select race").tag("")
                ForEach(viewModel.races) { race in
                    Text(race.name).tag(race.id)
                }
            }
            .pickerStyle(.menu)

            Picker("Driver", selection: $adjustmentDriverId) {
                Text("Select driver").tag("")
                ForEach(viewModel.drivers) { driver in
                    Text("#\(driver.number) \(driver.name)").tag(driver.id)
                }
            }
            .pickerStyle(.menu)

            Picker("Type", selection: $adjustmentType) {
                Text("Penalty").tag("penalty")
                Text("Correction").tag("correction")
            }
            .pickerStyle(.segmented)

            TextField("Delta Points (e.g. -10)", value: $adjustmentDeltaPoints, format: .number)
                .keyboardType(.numbersAndPunctuation)
                .textFieldStyle(.plain)
                .appInputField()

            TextField("Reason", text: $adjustmentReason, axis: .vertical)
                .lineLimit(2...4)
                .textFieldStyle(.plain)
                .appInputField()

            Button {
                guard !adjustmentRaceId.isEmpty, !adjustmentDriverId.isEmpty, !adjustmentReason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    adminError = "Race, driver, and reason are required."
                    adminMessage = nil
                    return
                }
                adminMessage = nil
                adminError = nil
                adminBusy = true
                viewModel.submitAdjustment(
                    raceId: adjustmentRaceId,
                    driverId: adjustmentDriverId,
                    type: adjustmentType,
                    deltaPoints: adjustmentDeltaPoints,
                    reason: adjustmentReason
                ) { result in
                    adminBusy = false
                    switch result {
                    case .success:
                        adminMessage = "Adjustment added."
                        adjustmentReason = ""
                    case .failure(let error):
                        adminError = error.localizedDescription
                    }
                }
            } label: {
                Text("Apply Adjustment")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(BrandPrimaryButtonStyle())
            .disabled(adminBusy)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .appCard()
    }

    private func picksSummary(title: String, ids: [String], color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(NASCARTheme.textFont(size: 12, weight: .bold))
                .foregroundStyle(color)
            ForEach(ids, id: \.self) { driverId in
                Text("#\(viewModel.driversById[driverId]?.number ?? "--") \(viewModel.driversById[driverId]?.name ?? driverId)")
                    .font(NASCARTheme.textFont(size: 13))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func seedRaceDefaultsIfNeeded() {
        guard !viewModel.races.isEmpty else { return }
        let fallbackRaceId = viewModel.selectedRaceId ?? viewModel.primaryRace?.id ?? viewModel.races.first?.id ?? ""
        if monitorRaceId.isEmpty {
            monitorRaceId = fallbackRaceId
        }
        if adjustmentRaceId.isEmpty {
            adjustmentRaceId = fallbackRaceId
        }
    }

    private func syncFromLeague() {
        guard let league = viewModel.selectedLeague else { return }
        name = league.name
        seasonYear = league.seasonYear
        payoutConfigText = league.payoutConfigText
    }
}
