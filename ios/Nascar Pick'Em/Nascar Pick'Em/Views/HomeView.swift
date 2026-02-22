import SwiftUI
import Combine

struct HomeView: View {
    @EnvironmentObject private var viewModel: PlayerViewModel
    @Environment(\.colorScheme) private var colorScheme
    @Binding var selectedTab: Int

    @State private var expandedLiveLeaderboardUserId: String?
    @State private var liveRefreshBusy = false
    @State private var liveRefreshUpdated = false
    @State private var liveRefreshError: String?
    @State private var liveRefreshCooldownUntil: Date?
    @State private var liveRefreshNow = Date()

    private let defaultLiveRefreshCooldownSeconds: Int = 60

    private enum PickTier: String {
        case tierA
        case tierB
        case tierC

        var color: Color {
            switch self {
            case .tierA:
                return NASCARTheme.yellow
            case .tierB:
                return NASCARTheme.red
            case .tierC:
                return NASCARTheme.blue
            }
        }
    }

    private struct LiveLeaderboardRow: Identifiable {
        let id: String
        let displayName: String
        let pick: PickItem?
        let weeklyTotal: Int
    }

    private struct LiveDriverPointRow: Identifiable {
        let driverId: String
        let points: Int
        let position: Int?
        var id: String { driverId }
    }

    private var unreadNotifications: [UserNotificationItem] {
        viewModel.notifications.filter { !$0.isRead }
    }

    private var liveDriverPointRows: [LiveDriverPointRow] {
        viewModel.liveRacePointsByDriverId
            .map { driverId, points in
                LiveDriverPointRow(
                    driverId: driverId,
                    points: points,
                    position: viewModel.driverPositionByDriverId[driverId]
                )
            }
            .sorted { lhs, rhs in
                let lhsPos = lhs.position ?? Int.max
                let rhsPos = rhs.position ?? Int.max
                if lhsPos != rhsPos { return lhsPos < rhsPos }
                if lhs.points != rhs.points { return lhs.points > rhs.points }
                let lhsName = viewModel.driversById[lhs.driverId]?.name ?? lhs.driverId
                let rhsName = viewModel.driversById[rhs.driverId]?.name ?? rhs.driverId
                return lhsName < rhsName
            }
    }

    private var liveRaceLeaderboardRows: [LiveLeaderboardRow] {
        guard viewModel.canSeeAllLiveRacePicks else { return [] }

        var userIds = Set<String>()
        viewModel.members.forEach { userIds.insert($0.id) }
        viewModel.liveRacePicks.forEach { userIds.insert($0.userId) }
        viewModel.liveWeeklyScores.forEach { userIds.insert($0.userId) }

        let pointsByDriverId = viewModel.liveRacePointsByDriverId
        let pickByUserId = Dictionary(uniqueKeysWithValues: viewModel.liveRacePicks.map { ($0.userId, $0) })
        let scoreByUserId = Dictionary(uniqueKeysWithValues: viewModel.liveWeeklyScores.map { ($0.userId, $0) })

        let rows = userIds.map { userId -> LiveLeaderboardRow in
            let pick = pickByUserId[userId]
            let score = scoreByUserId[userId]
            let weeklyTotal: Int
            if let score {
                weeklyTotal = score.weeklyTotal
            } else if let pick {
                weeklyTotal = (pick.tierA + pick.tierB + pick.tierC).reduce(0) { total, driverId in
                    total + (pointsByDriverId[driverId] ?? 0)
                }
            } else {
                weeklyTotal = 0
            }

            return LiveLeaderboardRow(
                id: userId,
                displayName: viewModel.members.first(where: { $0.id == userId })?.displayName ?? userId,
                pick: pick,
                weeklyTotal: weeklyTotal
            )
        }

        return rows.sorted { lhs, rhs in
            let lhsHasPick = lhs.pick != nil
            let rhsHasPick = rhs.pick != nil
            if lhsHasPick != rhsHasPick { return lhsHasPick && !rhsHasPick }
            if lhs.weeklyTotal != rhs.weeklyTotal { return lhs.weeklyTotal > rhs.weeklyTotal }
            return lhs.displayName < rhs.displayName
        }
    }

    private var liveRefreshSecondsRemaining: Int {
        guard let until = liveRefreshCooldownUntil else { return 0 }
        return max(0, Int(ceil(until.timeIntervalSince(liveRefreshNow))))
    }

    private var liveRefreshDisabled: Bool {
        liveRefreshBusy || liveRefreshSecondsRemaining > 0
    }

    private var liveRefreshButtonText: String {
        if liveRefreshBusy { return "REFRESHING" }
        if liveRefreshSecondsRemaining > 0, liveRefreshUpdated {
            return "UPDATED"
        }
        return "REFRESH"
    }

    private var currentUserPickTierByDriverId: [String: PickTier] {
        guard let pick = viewModel.currentPick else { return [:] }
        var map: [String: PickTier] = [:]
        pick.tierA.forEach { map[$0] = .tierA }
        pick.tierB.forEach { map[$0] = .tierB }
        pick.tierC.forEach { map[$0] = .tierC }
        return map
    }

    private var currentUserPickTierByCarNumber: [String: PickTier] {
        guard let pick = viewModel.currentPick else { return [:] }
        var map: [String: PickTier] = [:]

        func add(ids: [String], tier: PickTier) {
            for driverId in ids {
                if let driver = viewModel.driversById[driverId] {
                    let key = normalizedCarNumber(driver.number)
                    if !key.isEmpty { map[key] = tier }
                }
                let keyFromRaw = normalizedCarNumber(driverId)
                if !keyFromRaw.isEmpty, map[keyFromRaw] == nil {
                    map[keyFromRaw] = tier
                }
            }
        }

        add(ids: pick.tierA, tier: .tierA)
        add(ids: pick.tierB, tier: .tierB)
        add(ids: pick.tierC, tier: .tierC)
        return map
    }

    private var currentUserPickTierByNameKey: [String: PickTier] {
        guard let pick = viewModel.currentPick else { return [:] }
        var map: [String: PickTier] = [:]

        func add(ids: [String], tier: PickTier) {
            for driverId in ids {
                if let name = viewModel.driversById[driverId]?.name {
                    let key = normalizedName(name)
                    if !key.isEmpty { map[key] = tier }
                }
                let rawKey = normalizedName(driverId)
                if !rawKey.isEmpty, map[rawKey] == nil {
                    map[rawKey] = tier
                }
            }
        }

        add(ids: pick.tierA, tier: .tierA)
        add(ids: pick.tierB, tier: .tierB)
        add(ids: pick.tierC, tier: .tierC)
        return map
    }

    private var driverIdByCarNumber: [String: String] {
        var map: [String: String] = [:]
        for driver in viewModel.drivers {
            let key = normalizedCarNumber(driver.number)
            if !key.isEmpty, map[key] == nil {
                map[key] = driver.id
            }
        }
        return map
    }

    private func normalizedCarNumber(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "" }
        if let numeric = Int(trimmed) {
            return String(numeric)
        }
        return trimmed
    }

    private func normalizedName(_ value: String) -> String {
        value
            .lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .joined()
    }

    private func currentUserTier(forDriverKey rawDriverKey: String) -> PickTier? {
        let key = rawDriverKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if key.isEmpty { return nil }

        if let direct = currentUserPickTierByDriverId[key] {
            return direct
        }

        let carKey = normalizedCarNumber(key)
        if !carKey.isEmpty, let tier = currentUserPickTierByCarNumber[carKey] {
            return tier
        }

        if let resolvedId = driverIdByCarNumber[carKey],
           let tier = currentUserPickTierByDriverId[resolvedId] {
            return tier
        }

        if let driver = viewModel.driversById[key] {
            let nameKey = normalizedName(driver.name)
            if let tier = currentUserPickTierByNameKey[nameKey] {
                return tier
            }
        }

        let rawNameKey = normalizedName(key)
        if !rawNameKey.isEmpty, let tier = currentUserPickTierByNameKey[rawNameKey] {
            return tier
        }

        return nil
    }

    private func resolvedDriver(forLookupKey rawDriverKey: String) -> DriverItem? {
        if let direct = viewModel.driversById[rawDriverKey] {
            return direct
        }
        let carKey = normalizedCarNumber(rawDriverKey)
        guard !carKey.isEmpty,
              let resolvedId = driverIdByCarNumber[carKey] else {
            return nil
        }
        return viewModel.driversById[resolvedId]
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    if let liveRace = viewModel.effectiveLiveRace {
                        liveRaceCard(liveRace: liveRace)

                        if !liveDriverPointRows.isEmpty {
                            liveDriverPointsCard
                        }

                        liveRaceLeaderboardCard

                        if viewModel.primaryRace != nil {
                            yourPicksCard
                        }

                        if !unreadNotifications.isEmpty {
                            remindersCard
                        }
                    } else {
                        if !unreadNotifications.isEmpty {
                            remindersCard
                        }

                        if let primaryRace = viewModel.primaryRace {
                            raceCard(race: primaryRace)
                            yourPicksCard
                        } else {
                            Text("No upcoming race loaded.")
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .appCard()
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 60)
                .padding(.bottom, 12)
            }
            .appScreenBackground()
            .toolbar(.hidden, for: .navigationBar)
            .onChange(of: viewModel.effectiveLiveRace?.id) { _, _ in
                expandedLiveLeaderboardUserId = viewModel.currentUserId
                liveRefreshBusy = false
                liveRefreshUpdated = false
                liveRefreshError = nil
                liveRefreshCooldownUntil = nil
            }
            .onChange(of: viewModel.currentUserId) { _, newUserId in
                if expandedLiveLeaderboardUserId == nil {
                    expandedLiveLeaderboardUserId = newUserId
                }
            }
            .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { value in
                liveRefreshNow = value
            }
        }
    }

    private var remindersCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Reminders")
                .font(NASCARTheme.displayFont(size: 20, weight: .bold))
                .textCase(.uppercase)
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(unreadNotifications.prefix(3))) { item in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.title.isEmpty ? "Pick reminder" : item.title)
                            .font(NASCARTheme.textFont(size: 14, weight: .semibold))
                        Text(item.message)
                            .font(NASCARTheme.textFont(size: 13))
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        if let lock = item.lockTime {
                            Text("Locks: \(lock.formatted(date: .abbreviated, time: .shortened))")
                                .font(NASCARTheme.textFont(size: 12))
                                .foregroundStyle(.secondary)
                        }
                        Button("Mark read") {
                            viewModel.markNotificationRead(item.id)
                        }
                        .font(NASCARTheme.textFont(size: 12, weight: .semibold))
                        .buttonStyle(.plain)
                        .foregroundStyle(NASCARTheme.blue)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(NASCARTheme.secondarySurface(for: colorScheme))
                    )
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .appCard()
    }

    // MARK: - Live section

    private func liveRaceCard(liveRace: RaceItem) -> some View {
        let lapText: String?
        if let lap = viewModel.liveRacePointsDocument.liveLapNumber,
           let total = viewModel.liveRacePointsDocument.liveLapsInRace {
            let stageText: String
            if let stage = viewModel.liveRacePointsDocument.liveStage {
                if lap <= stage.finishAtLap {
                    stageText = " · Stage \(stage.stageNum) (ends lap \(stage.finishAtLap))"
                } else {
                    let nextStageNum = min(stage.stageNum + 1, 3)
                    let nextFinishAtLap = nextStageNum == 3 ? total : stage.finishAtLap
                    stageText = " · Stage \(nextStageNum) (ends lap \(nextFinishAtLap))"
                }
            } else {
                stageText = ""
            }
            lapText = "Lap \(lap)/\(total)\(stageText)"
        } else {
            lapText = nil
        }

        return VStack(alignment: .leading, spacing: 6) {
            Text(liveRace.name)
                .font(NASCARTheme.raceNameFont(size: 28, weight: .bold))
                .textCase(.uppercase)
            HStack(alignment: .center, spacing: 8) {
                Text(liveRace.track)
                    .font(NASCARTheme.textFont(size: 16))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Text("LIVE")
                    .font(NASCARTheme.textFont(size: 12, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(NASCARTheme.red))
            }
            if let lapText {
                Text(lapText)
                    .font(NASCARTheme.textFont(size: 15))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            HStack(alignment: .center, spacing: 8) {
                Link(destination: URL(string: "https://www.nascar.com/live-results/nascar-cup-series/\(liveRace.id)/")!) {
                    Text("Live leaderboard on NASCAR.com")
                        .font(NASCARTheme.textFont(size: 14, weight: .semibold))
                        .foregroundStyle(NASCARTheme.yellow)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Button {
                    triggerLiveRefresh()
                } label: {
                    Text(
                        liveRefreshButtonText
                    )
                        .font(NASCARTheme.textFont(size: 12, weight: .bold))
                        .lineLimit(1)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(
                            Capsule().fill(NASCARTheme.blue)
                        )
                }
                .buttonStyle(.plain)
                .disabled(liveRefreshDisabled)
                .opacity(liveRefreshDisabled ? 0.65 : 1)
            }
            if let liveRefreshError {
                Text(liveRefreshError)
                    .font(NASCARTheme.textFont(size: 13, weight: .semibold))
                    .foregroundStyle(NASCARTheme.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .appCard()
    }

    private func triggerLiveRefresh() {
        if liveRefreshDisabled { return }
        liveRefreshBusy = true
        liveRefreshUpdated = false
        liveRefreshError = nil
        viewModel.syncLiveRaceNow { result in
            liveRefreshBusy = false
            switch result {
            case .success(let sync):
                liveRefreshUpdated = sync.updated
                let cooldownSeconds = max(1, sync.retryAfterSeconds ?? defaultLiveRefreshCooldownSeconds)
                liveRefreshCooldownUntil = Date().addingTimeInterval(TimeInterval(cooldownSeconds))
            case .failure(let error):
                liveRefreshUpdated = false
                liveRefreshError = error.localizedDescription
            }
        }
    }

    private var liveRaceLeaderboardCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Live Leaderboard")
                .font(NASCARTheme.displayFont(size: 20, weight: .bold))
                .textCase(.uppercase)

            if !viewModel.canSeeAllLiveRacePicks {
                Text("All picks become visible when the race starts.")
                    .font(NASCARTheme.textFont(size: 15))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else if liveRaceLeaderboardRows.isEmpty {
                Text("No picks submitted for this race yet.")
                    .font(NASCARTheme.textFont(size: 15))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(liveRaceLeaderboardRows.enumerated()), id: \.element.id) { index, row in
                        let isExpanded = expandedLiveLeaderboardUserId == row.id
                        VStack(alignment: .leading, spacing: 6) {
                            Button {
                                expandedLiveLeaderboardUserId = isExpanded ? nil : row.id
                            } label: {
                                HStack(spacing: 8) {
                                    Text("#\(index + 1)")
                                        .font(NASCARTheme.textFont(size: 13, weight: .bold))
                                        .foregroundStyle(.secondary)
                                        .frame(width: 30, alignment: .leading)
                                    Text(row.displayName)
                                        .font(NASCARTheme.textFont(size: 14, weight: .semibold))
                                        .lineLimit(1)
                                    Spacer()
                                    Text("\(row.weeklyTotal)")
                                        .font(NASCARTheme.textFont(size: 14, weight: .bold))
                                    Text(isExpanded ? "▼" : "▶")
                                        .font(NASCARTheme.textFont(size: 12, weight: .bold))
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .buttonStyle(.plain)

                            if isExpanded {
                                if let pick = row.pick {
                                    leaderboardPicksSummary(title: "Tier A", ids: pick.tierA, color: NASCARTheme.yellow)
                                    leaderboardPicksSummary(title: "Tier B", ids: pick.tierB, color: NASCARTheme.red)
                                    leaderboardPicksSummary(title: "Tier C", ids: pick.tierC, color: NASCARTheme.blue)
                                } else {
                                    Text("No pick submitted for this race.")
                                        .font(NASCARTheme.textFont(size: 13))
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(.clear)
                        )
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .appCard()
    }

    private var liveDriverPointsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Live results")
                .font(NASCARTheme.displayFont(size: 20, weight: .bold))
                .textCase(.uppercase)
            VStack(alignment: .leading, spacing: 6) {
                ForEach(liveDriverPointRows) { entry in
                    let driver = resolvedDriver(forLookupKey: entry.driverId)
                    let pickedTier = currentUserTier(forDriverKey: entry.driverId)
                    let highlightColor = pickedTier?.color
                    HStack(spacing: 8) {
                        Text(entry.position.map(String.init) ?? "—")
                            .font(NASCARTheme.textFont(size: 13, weight: .bold))
                            .foregroundStyle(.secondary)
                            .frame(width: 28, alignment: .leading)
                            .padding(.leading, 2)
                        Text(driver?.name ?? entry.driverId)
                            .font(NASCARTheme.textFont(size: 15, weight: .semibold))
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                        Spacer()
                        Text("\(entry.points)")
                            .font(NASCARTheme.textFont(size: 15, weight: .bold))
                            .foregroundStyle(highlightColor ?? .primary)
                            .frame(minWidth: 28, alignment: .trailing)
                            .padding(.trailing, 2)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 4)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill((highlightColor ?? .clear).opacity(colorScheme == .dark ? 0.18 : 0.1))
                    )
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
                        picksTierSection(
                            title: "Tier A",
                            driverIds: pick.tierA,
                            tierColor: NASCARTheme.yellow,
                            positionByDriverId: viewModel.driverPositionByDriverId,
                            pointsByDriverId: viewModel.liveRacePointsByDriverId
                        )
                    }
                    if !pick.tierB.isEmpty {
                        picksTierSection(
                            title: "Tier B",
                            driverIds: pick.tierB,
                            tierColor: NASCARTheme.red,
                            positionByDriverId: viewModel.driverPositionByDriverId,
                            pointsByDriverId: viewModel.liveRacePointsByDriverId
                        )
                    }
                    if !pick.tierC.isEmpty {
                        picksTierSection(
                            title: "Tier C",
                            driverIds: pick.tierC,
                            tierColor: NASCARTheme.blue,
                            positionByDriverId: viewModel.driverPositionByDriverId,
                            pointsByDriverId: viewModel.liveRacePointsByDriverId
                        )
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

    private func leaderboardPicksSummary(title: String, ids: [String], color _: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(NASCARTheme.textFont(size: 12, weight: .bold))
                .foregroundStyle(.primary)
            ForEach(ids, id: \.self) { driverId in
                let driver = viewModel.driversById[driverId]
                let position = viewModel.driverPositionByDriverId[driverId]
                let pickedTier = currentUserTier(forDriverKey: driverId)
                let highlightColor = pickedTier?.color
                HStack(spacing: 6) {
                    HStack(spacing: 6) {
                        if let position {
                            Text("#\(position)")
                                .font(NASCARTheme.textFont(size: 13, weight: .bold))
                                .foregroundStyle(.primary)
                        } else {
                            Text("#\(driver?.number ?? "--")")
                                .font(NASCARTheme.textFont(size: 13))
                                .foregroundStyle(.primary)
                        }
                        Text(driver?.name ?? driverId)
                            .font(NASCARTheme.textFont(size: 13))
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                    }
                    Spacer()
                    if let points = viewModel.liveRacePointsByDriverId[driverId] {
                        Text("\(points)")
                            .font(NASCARTheme.textFont(size: 13, weight: .bold))
                            .foregroundStyle(.primary)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill((highlightColor ?? .clear).opacity(colorScheme == .dark ? 0.22 : 0.1))
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func picksTierSection(
        title: String,
        driverIds: [String],
        tierColor: Color,
        positionByDriverId: [String: Int] = [:],
        pointsByDriverId: [String: Int] = [:]
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title)
                    .font(NASCARTheme.displayFont(size: 20, weight: .bold))
                    .textCase(.uppercase)
            }
            VStack(alignment: .leading, spacing: 8) {
                ForEach(driverIds, id: \.self) { driverId in
                    let driver = viewModel.driversById[driverId]
                    let runningPosition = positionByDriverId[driverId]
                    let points = pointsByDriverId[driverId]
                    HStack(spacing: 6) {
                        HStack(spacing: 6) {
                            if let pos = runningPosition {
                                Text("#\(pos)")
                                    .font(NASCARTheme.textFont(size: 15, weight: .bold))
                                    .foregroundStyle(.primary)
                            } else {
                                Text("#\(driver?.number ?? "--")")
                                    .font(NASCARTheme.textFont(size: 15, weight: .semibold))
                            }
                            Text(driver?.name ?? driverId)
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

                        if let points {
                            Text("\(points)")
                                .font(NASCARTheme.textFont(size: 14, weight: .bold))
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
