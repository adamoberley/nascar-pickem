import SwiftUI

struct RaceView: View {
    @EnvironmentObject private var viewModel: PlayerViewModel
    @Environment(\.colorScheme) private var colorScheme

    @State private var showingRacePicker = false
    @State private var expandedLeaderboardUserId: String?

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

    private struct LeaderboardRow: Identifiable {
        let id: String
        let displayName: String
        let pick: PickItem?
        let weeklyTotal: Int
    }

    private struct ResultRow: Identifiable {
        let driverId: String
        let points: Int
        let position: Int?
        var id: String { driverId }
    }

    private var racePointsByDriverId: [String: Int] {
        Dictionary(viewModel.selectedRacePointsWithAdjustments, uniquingKeysWith: { current, _ in current })
    }

    private var selectedRaceResultRows: [ResultRow] {
        viewModel.selectedRacePointsWithAdjustments
            .map { driverId, points in
                ResultRow(
                    driverId: driverId,
                    points: points,
                    position: viewModel.selectedRacePositionByDriverId[driverId]
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

    private var selectedRacePickTotal: Int? {
        guard let pick = viewModel.selectedRacePick else { return nil }
        let all = pick.tierA + pick.tierB + pick.tierC
        if all.isEmpty { return nil }
        return all.reduce(0) { $0 + (racePointsByDriverId[$1] ?? 0) }
    }

    private var selectedRaceUserPickTierByDriverId: [String: PickTier] {
        guard let pick = viewModel.selectedRacePick else { return [:] }
        var map: [String: PickTier] = [:]
        pick.tierA.forEach { map[$0] = .tierA }
        pick.tierB.forEach { map[$0] = .tierB }
        pick.tierC.forEach { map[$0] = .tierC }
        return map
    }

    private var selectedRaceUserPickTierByCarNumber: [String: PickTier] {
        guard let pick = viewModel.selectedRacePick else { return [:] }
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

    private var selectedRaceUserPickTierByNameKey: [String: PickTier] {
        guard let pick = viewModel.selectedRacePick else { return [:] }
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

    private func selectedRaceTier(forDriverKey rawDriverKey: String) -> PickTier? {
        let key = rawDriverKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if key.isEmpty { return nil }

        if let direct = selectedRaceUserPickTierByDriverId[key] {
            return direct
        }

        let carKey = normalizedCarNumber(key)
        if !carKey.isEmpty, let tier = selectedRaceUserPickTierByCarNumber[carKey] {
            return tier
        }

        if let resolvedId = driverIdByCarNumber[carKey],
           let tier = selectedRaceUserPickTierByDriverId[resolvedId] {
            return tier
        }

        if let driver = viewModel.driversById[key] {
            let nameKey = normalizedName(driver.name)
            if let tier = selectedRaceUserPickTierByNameKey[nameKey] {
                return tier
            }
        }

        let rawNameKey = normalizedName(key)
        if !rawNameKey.isEmpty, let tier = selectedRaceUserPickTierByNameKey[rawNameKey] {
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

    private var raceLeaderboardRows: [LeaderboardRow] {
        guard viewModel.canSeeAllPicksForSelectedRace else { return [] }
        var ids = Set<String>()
        viewModel.members.forEach { ids.insert($0.id) }
        viewModel.selectedRacePicks.forEach { ids.insert($0.userId) }
        viewModel.selectedRaceWeeklyScores.forEach { ids.insert($0.userId) }

        let pickByUserId = Dictionary(uniqueKeysWithValues: viewModel.selectedRacePicks.map { ($0.userId, $0) })
        let scoreByUserId = Dictionary(uniqueKeysWithValues: viewModel.selectedRaceWeeklyScores.map { ($0.userId, $0) })

        let rows = ids.map { userId -> LeaderboardRow in
            let pick = pickByUserId[userId]
            let score = scoreByUserId[userId]
            let total: Int
            if let score {
                total = score.weeklyTotal
            } else if let pick {
                total = (pick.tierA + pick.tierB + pick.tierC).reduce(0) { $0 + (racePointsByDriverId[$1] ?? 0) }
            } else {
                total = 0
            }

            return LeaderboardRow(
                id: userId,
                displayName: viewModel.members.first(where: { $0.id == userId })?.displayName ?? userId,
                pick: pick,
                weeklyTotal: total
            )
        }

        return rows.sorted { a, b in
            let aHasPick = a.pick != nil
            let bHasPick = b.pick != nil
            if aHasPick != bHasPick { return aHasPick && !bHasPick }
            if a.weeklyTotal != b.weeklyTotal { return a.weeklyTotal > b.weeklyTotal }
            return a.displayName < b.displayName
        }
    }

    private var maxPossibleRacePoints: Int? {
        let allPoints = racePointsByDriverId.values.sorted(by: >)
        guard allPoints.count >= 6 else { return nil }
        return Array(allPoints.prefix(6)).reduce(0, +)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    raceSelectorCard

                    if viewModel.selectedRace != nil {
                        yourPicksCard
                        raceLeaderboardCard
                        resultsCard
                    }
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
            .onChange(of: viewModel.selectedRaceId) { _, _ in
                expandedLeaderboardUserId = nil
            }
        }
    }

    private var raceSelectorCard: some View {
        Button {
            showingRacePicker = true
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                if let race = viewModel.selectedRace {
                    HStack(spacing: 8) {
                        Text(race.name)
                            .font(NASCARTheme.raceNameFont(size: 28, weight: .bold))
                            .textCase(.uppercase)
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
                } else {
                    HStack {
                        Text("Select a race")
                            .font(NASCARTheme.textFont(size: 16))
                            .foregroundStyle(.secondary)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(NASCARTheme.textFont(size: 14))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .appCard()
    }

    private var yourPicksCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center) {
                Text("Your Picks")
                    .font(NASCARTheme.displayFont(size: 24, weight: .bold))
                    .textCase(.uppercase)
                Spacer(minLength: 12)
                if let total = viewModel.selectedRaceScore?.weeklyTotal ?? selectedRacePickTotal {
                    HStack(spacing: 6) {
                        Text("Total")
                            .font(NASCARTheme.textFont(size: 15))
                            .foregroundStyle(.secondary)
                        Text("\(total)")
                            .font(NASCARTheme.textFont(size: 15, weight: .bold))
                            .foregroundStyle(.primary)
                    }
                    .padding(.trailing, 10)
                }
            }

            if let pick = viewModel.selectedRacePick, !pick.tierA.isEmpty || !pick.tierB.isEmpty || !pick.tierC.isEmpty {
                picksSummary(title: "Tier A", ids: pick.tierA, color: NASCARTheme.yellow)
                picksSummary(title: "Tier B", ids: pick.tierB, color: NASCARTheme.red)
                picksSummary(title: "Tier C", ids: pick.tierC, color: NASCARTheme.blue)
            } else if let race = viewModel.selectedRace,
                      race.status == .scheduled && race.lockTime.timeIntervalSinceNow > 0 {
                Text("You can make your picks the week of the race.")
                    .font(NASCARTheme.textFont(size: 15))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else if let race = viewModel.selectedRace,
                      race.status == .locked || race.status == .completed {
                Text("No pick submitted for this race.")
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
    }

    private var raceLeaderboardCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Race Leaderboard")
                    .font(NASCARTheme.displayFont(size: 24, weight: .bold))
                    .textCase(.uppercase)
                Spacer()
                if let maxPossibleRacePoints {
                    HStack(spacing: 6) {
                        Text("Max")
                            .font(NASCARTheme.textFont(size: 15))
                            .foregroundStyle(.secondary)
                        Text("\(maxPossibleRacePoints)")
                            .font(NASCARTheme.textFont(size: 15, weight: .bold))
                    }
                }
            }

            if !viewModel.canSeeAllPicksForSelectedRace {
                Text("All picks become visible when the race starts.")
                    .font(NASCARTheme.textFont(size: 15))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else if raceLeaderboardRows.isEmpty {
                Text("No picks submitted for this race yet.")
                    .font(NASCARTheme.textFont(size: 15))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(raceLeaderboardRows.enumerated()), id: \.element.id) { index, row in
                        let isExpanded = expandedLeaderboardUserId == row.id
                        VStack(alignment: .leading, spacing: 6) {
                            Button {
                                expandedLeaderboardUserId = isExpanded ? nil : row.id
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
                                    picksSummary(title: "Tier A", ids: pick.tierA, color: NASCARTheme.yellow)
                                    picksSummary(title: "Tier B", ids: pick.tierB, color: NASCARTheme.red)
                                    picksSummary(title: "Tier C", ids: pick.tierC, color: NASCARTheme.blue)
                                } else {
                                    Text("No pick submitted for this race.")
                                        .font(NASCARTheme.textFont(size: 13))
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(.clear))
                    }
                }
            }
        }
        .appCard()
    }

    private var resultsCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Results")
                .font(NASCARTheme.displayFont(size: 24, weight: .bold))
                .textCase(.uppercase)
            if selectedRaceResultRows.isEmpty {
                Text("No official points loaded yet.")
                    .font(NASCARTheme.textFont(size: 15))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(selectedRaceResultRows) { row in
                        let driver = resolvedDriver(forLookupKey: row.driverId)
                        let highlightColor = selectedRaceTier(forDriverKey: row.driverId)?.color
                        HStack(spacing: 8) {
                            Text(row.position.map(String.init) ?? "—")
                                .font(NASCARTheme.textFont(size: 13, weight: .bold))
                                .foregroundStyle(.secondary)
                                .frame(width: 28, alignment: .leading)
                                .padding(.leading, 2)
                            HStack(spacing: 6) {
                                Text(driver?.name ?? row.driverId)
                                    .font(NASCARTheme.textFont(size: 15, weight: .semibold))
                                    .foregroundStyle(.primary)
                                if let team = driver?.team, !team.isEmpty {
                                    Text(team)
                                        .font(NASCARTheme.textFont(size: 12))
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            Text("\(row.points)")
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
        }
        .appCard()
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

    private func picksSummary(title: String, ids: [String], color _: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(NASCARTheme.textFont(size: 12, weight: .bold))
                .foregroundStyle(.primary)
            ForEach(ids, id: \.self) { driverId in
                let driver = viewModel.driversById[driverId]
                let position = viewModel.selectedRacePositionByDriverId[driverId]
                let pickedTier = selectedRaceTier(forDriverKey: driverId)
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
                    if let points = racePointsByDriverId[driverId] {
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
    private func lockCountdown(lockDate: Date, isPast: Bool) -> some View {
        if !isPast {
            TimelineView(.periodic(from: .now, by: 1)) { _ in
                let remaining = max(0, Int(lockDate.timeIntervalSinceNow))
                if remaining > 0 {
                    let hours = remaining / 3600
                    let minutes = (remaining % 3600) / 60
                    let seconds = remaining % 60
                    let days = hours / 24
                    let displayHours = hours % 24
                    let countdownText = hours >= 1
                        ? String(format: "Locks in %dd %dh %dm", days, displayHours, minutes)
                        : String(format: "Locks in %dm %ds", minutes, seconds)

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
}
