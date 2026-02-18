import SwiftUI

/// Sprint = calendar month. Payout: Feb $30, Mar–Aug $120 each ($750 total).
private struct SprintConfig {
    let name: String
    let index: Int       // 1 = February ... 7 = August
    let month: Int       // Calendar month 2...8
    let payout: String
}

struct StandingsView: View {
    @EnvironmentObject private var viewModel: PlayerViewModel
    @Environment(\.colorScheme) private var colorScheme

    @State private var selectedRaceIdForWeekly: String?
    @State private var selectedSprintIndex: Int = 0  // 0 = Current
    @State private var isWeeklyExpanded = false
    @State private var isMonthlyExpanded = false
    @State private var isSeasonExpanded = false

    private static let sprintConfigs: [SprintConfig] = [
        SprintConfig(name: "February", index: 1, month: 2, payout: "$30"),
        SprintConfig(name: "March", index: 2, month: 3, payout: "$120"),
        SprintConfig(name: "April", index: 3, month: 4, payout: "$120"),
        SprintConfig(name: "May", index: 4, month: 5, payout: "$120"),
        SprintConfig(name: "June", index: 5, month: 6, payout: "$120"),
        SprintConfig(name: "July", index: 6, month: 7, payout: "$120"),
        SprintConfig(name: "August", index: 7, month: 8, payout: "$120"),
    ]

    /// Races that count for picks: February through August (non-playoff segment).
    private var scoredRaces: [RaceItem] {
        let races = viewModel.races.filter { race in
            let month = Calendar.current.component(.month, from: race.startTime)
            return (2...8).contains(month)
        }
        .sorted { $0.startTime < $1.startTime }
        return races.isEmpty ? viewModel.races.sorted { $0.startTime < $1.startTime } : races
    }

    /// Map race id -> sprint index (1–7) for scored races, by calendar month. Feb=1 … Aug=7.
    private var raceIdToSprintIndex: [String: Int] {
        let calendar = Calendar.current
        var map: [String: Int] = [:]
        for race in scoredRaces {
            let month = calendar.component(.month, from: race.startTime)
            if (2...8).contains(month) {
                map[race.id] = month - 1  // Feb 2 -> 1, Aug 8 -> 7
            }
        }
        return map
    }

    /// Race that should be "current" for weekly: most recent completed *scored* race, or next upcoming scored race (never blank).
    private var currentRaceId: String? {
        scoredRaces.last(where: { $0.status == .completed })?.id
            ?? scoredRaces.first(where: { $0.status == .scheduled && $0.lockTime.timeIntervalSinceNow > 0 })?.id
            ?? scoredRaces.first(where: { $0.status == .scheduled })?.id
            ?? scoredRaces.last?.id
    }

    /// Sprint we're in: month of most recent completed *scored* race, or 1 (February) if none.
    private var currentSprintIndex: Int {
        guard let lastCompleted = scoredRaces.last(where: { $0.status == .completed }),
              let sprint = raceIdToSprintIndex[lastCompleted.id] else {
            return 1
        }
        return sprint
    }

    /// Resolved race id for weekly leaderboard (selected or current).
    private var effectiveWeeklyRaceId: String? {
        selectedRaceIdForWeekly ?? currentRaceId
    }

    /// Resolved sprint index for sprint leaderboard (0 = current, else 1...7).
    private var effectiveSprintIndex: Int {
        selectedSprintIndex == 0 ? currentSprintIndex : selectedSprintIndex
    }

    /// Weekly leaderboard rows for the selected race: (rank, userId, points) sorted by points desc.
    private var weeklyLeaderboardRows: [(rank: Int, userId: String, points: Int)] {
        guard let raceId = effectiveWeeklyRaceId else { return [] }
        let scores = viewModel.allWeeklyScores
            .filter { $0.raceId == raceId }
            .sorted { $0.weeklyTotal > $1.weeklyTotal }
        return scores.enumerated().map { (rank: $0.offset + 1, userId: $0.element.userId, points: $0.element.weeklyTotal) }
    }

    /// Races to show in weekly picker: current (first) then completed *scored* races by date.
    private var weeklyRacePickerOptions: [(id: String?, label: String)] {
        var options: [(id: String?, label: String)] = []
        if let currentId = currentRaceId, let race = scoredRaces.first(where: { $0.id == currentId }) {
            options.append((nil, "Current (\(race.name))"))
        }
        let completed = scoredRaces.filter { $0.status == .completed }
        for race in completed {
            options.append((race.id, race.name))
        }
        return options
    }

    private var mergedStandingsRows: [StandingsRowItem] {
        let memberNames = Set(viewModel.members.map(\.displayName))
        let expectedNames = viewModel.selectedLeague?.memberNames ?? []
        let scoreIds = Set(viewModel.seasonScores.map(\.id))
        var rows: [StandingsRowItem] = viewModel.seasonScores.map { score in
            let displayName = viewModel.members.first(where: { $0.id == score.id })?.displayName ?? score.id
            return StandingsRowItem(
                id: score.id,
                displayName: displayName,
                seasonTotal: score.seasonTotal,
                rank: score.rank,
                isPlaceholder: false
            )
        }
        // Include members who have no season score yet (e.g. new admin) so they always appear
        for member in viewModel.members where !scoreIds.contains(member.id) {
            rows.append(StandingsRowItem(
                id: member.id,
                displayName: member.displayName,
                seasonTotal: 0,
                rank: 0,
                isPlaceholder: false
            ))
        }
        for name in expectedNames where !memberNames.contains(name) {
            rows.append(StandingsRowItem(
                id: "expected:\(name)",
                displayName: name,
                seasonTotal: 0,
                rank: 0,
                isPlaceholder: true
            ))
        }
        rows.sort { a, b in
            if a.seasonTotal != b.seasonTotal { return a.seasonTotal > b.seasonTotal }
            return a.displayName.localizedCompare(b.displayName) == .orderedAscending
        }
        return rows.enumerated().map { index, row in
            StandingsRowItem(
                id: row.id,
                displayName: row.displayName,
                seasonTotal: row.seasonTotal,
                rank: index + 1,
                isPlaceholder: row.isPlaceholder
            )
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    weeklyLeaderboardSection
                    sprintLeaderboardSection
                    seasonLeaderboardSection
                }
                .padding(.horizontal, 16)
                .padding(.top, 60)
                .padding(.bottom, 12)
            }
            .appScreenBackground()
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    // MARK: - Weekly Leaderboard

    private var weeklyLeaderboardSection: some View {
        let rows = weeklyLeaderboardRows
        let limit = isWeeklyExpanded ? rows.count : min(3, rows.count)
        let hasMore = rows.count > 3
        return VStack(alignment: .leading, spacing: 10) {
            Text("Weekly Leaderboard")
                .font(NASCARTheme.displayFont(size: 20, weight: .bold))
                .textCase(.uppercase)
            weeklyRacePickerLabel
            if rows.isEmpty {
                Text("No scores yet for this race.")
                    .font(NASCARTheme.textFont(size: 15))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ZStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(Array(rows.prefix(limit).enumerated()), id: \.offset) { _, row in
                            leaderboardRow(rank: row.rank, displayName: displayName(for: row.userId), points: row.points, isCurrentUser: row.userId == viewModel.currentUserId)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, hasMore ? 20 : 0)
                    if hasMore {
                        expandCollapseOverlay(
                            isExpanded: isWeeklyExpanded,
                            onTap: { isWeeklyExpanded.toggle() }
                        )
                    }
                }
            }
        }
        .appCard()
    }

    private var weeklyRacePickerLabel: some View {
        Menu {
            ForEach(Array(weeklyRacePickerOptions.enumerated()), id: \.offset) { _, option in
                Button {
                    selectedRaceIdForWeekly = option.id
                } label: {
                    HStack {
                        Text(option.label)
                        if (option.id == nil && selectedRaceIdForWeekly == nil) || option.id == selectedRaceIdForWeekly {
                            Image(systemName: "checkmark")
                        }
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(effectiveWeeklyRaceId.flatMap { raceName(for: $0) } ?? "Select race")
                    .font(NASCARTheme.textFont(size: 13))
                    .foregroundStyle(.secondary)
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .tint(.secondary)
    }

    // MARK: - Monthly Leaderboard

    private var sprintLeaderboardSection: some View {
        let config = Self.sprintConfigs.first(where: { $0.index == effectiveSprintIndex }) ?? Self.sprintConfigs[0]
        let rows = sprintLeaderboard(for: config)
        let limit = isMonthlyExpanded ? rows.count : min(3, rows.count)
        let hasMore = rows.count > 3
        return VStack(alignment: .leading, spacing: 10) {
            Text("Monthly Leaderboard")
                .font(NASCARTheme.displayFont(size: 20, weight: .bold))
                .textCase(.uppercase)
            monthlyPickerLabel(config: config)
            if rows.isEmpty {
                Text("No scores yet for this month.")
                    .font(NASCARTheme.textFont(size: 15))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ZStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(Array(rows.prefix(limit).enumerated()), id: \.element.userId) { index, row in
                            leaderboardRow(rank: index + 1, displayName: displayName(for: row.userId), points: row.total, isCurrentUser: row.userId == viewModel.currentUserId)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, hasMore ? 20 : 0)
                    if hasMore {
                        expandCollapseOverlay(
                            isExpanded: isMonthlyExpanded,
                            onTap: { isMonthlyExpanded.toggle() }
                        )
                    }
                }
            }
        }
        .appCard()
    }

    private func monthlyPickerLabel(config: SprintConfig) -> some View {
        Menu {
            Button {
                selectedSprintIndex = 0
            } label: {
                HStack {
                    Text("Current (\(Self.sprintConfigs.first(where: { $0.index == currentSprintIndex })?.name ?? "Sprint"))")
                    if selectedSprintIndex == 0 { Image(systemName: "checkmark") }
                }
            }
            ForEach(Self.sprintConfigs, id: \.index) { c in
                Button {
                    selectedSprintIndex = c.index
                } label: {
                    HStack {
                        Text("\(c.name) · \(c.payout)")
                        if selectedSprintIndex == c.index { Image(systemName: "checkmark") }
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text("\(config.name) · \(config.payout)")
                    .font(NASCARTheme.textFont(size: 13))
                    .foregroundStyle(.secondary)
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .tint(.secondary)
    }

    // MARK: - Season Leaderboard

    private var seasonLeaderboardSection: some View {
        let rows = mergedStandingsRows
        let limit = isSeasonExpanded ? rows.count : min(3, rows.count)
        let hasMore = rows.count > 3
        return VStack(alignment: .leading, spacing: 10) {
            Text("Season Leaderboard")
                .font(NASCARTheme.displayFont(size: 20, weight: .bold))
                .textCase(.uppercase)
            Text("1st $1,000 · 2nd $250 · 3rd $100")
                .font(NASCARTheme.textFont(size: 13))
                .foregroundStyle(.secondary)
            ZStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(rows.prefix(limit))) { row in
                        HStack(spacing: 6) {
                            Text("#\(row.rank)")
                                .font(NASCARTheme.textFont(size: 15, weight: .bold))
                                .frame(width: 32, alignment: .leading)
                            Text(row.displayName)
                                .font(NASCARTheme.textFont(size: 15, weight: .semibold))
                                .lineLimit(1)
                                .layoutPriority(1)
                                .opacity(row.isPlaceholder ? 0.9 : 1)
                            Spacer()
                            Text("\(row.seasonTotal)")
                                .font(NASCARTheme.textFont(size: 15, weight: .bold))
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(payoutBackground(for: row.rank))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .stroke(
                                    row.id == viewModel.currentUserId ? NASCARTheme.blue : .clear,
                                    lineWidth: row.id == viewModel.currentUserId ? 2 : 0
                                )
                        )
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, hasMore ? 20 : 0)
                if hasMore {
                    expandCollapseOverlay(
                        isExpanded: isSeasonExpanded,
                        onTap: { isSeasonExpanded.toggle() }
                    )
                }
            }
        }
        .appCard()
    }

    // MARK: - Shared helpers

    /// Bottom-of-card expand/collapse: chevron in the padding between last row and card edge.
    private static let expandCollapsePadding: CGFloat = 20
    private func expandCollapseOverlay(isExpanded: Bool, onTap: @escaping () -> Void) -> some View {
        Button(action: onTap) {
            VStack(spacing: 0) {
                Spacer(minLength: 0)
                Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .frame(height: Self.expandCollapsePadding)
        }
        .buttonStyle(.plain)
    }

    private func leaderboardRow(rank: Int, displayName: String, points: Int, isCurrentUser: Bool) -> some View {
        let isLeader = (rank == 1)
        return HStack(spacing: 6) {
            Text("#\(rank)")
                .font(NASCARTheme.textFont(size: 15, weight: .bold))
                .frame(width: 32, alignment: .leading)
            Text(displayName)
                .font(NASCARTheme.textFont(size: 15, weight: .semibold))
                .lineLimit(1)
                .layoutPriority(1)
            Spacer()
            Text("\(points)")
                .font(NASCARTheme.textFont(size: 15, weight: .bold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(payoutBackground(for: rank))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(
                    isCurrentUser ? NASCARTheme.blue : (isLeader ? Self.gold : .clear),
                    lineWidth: (isCurrentUser || isLeader) ? 2 : 0
                )
        )
    }

    /// Sprint leaderboard for one month: sum weekly scores for scored races in that calendar month.
    private func sprintLeaderboard(for config: SprintConfig) -> [(userId: String, total: Int)] {
        let sprintIndexByRace = raceIdToSprintIndex
        var userTotals: [String: Int] = [:]
        for score in viewModel.allWeeklyScores {
            guard let sprint = sprintIndexByRace[score.raceId], sprint == config.index else { continue }
            userTotals[score.userId, default: 0] += score.weeklyTotal
        }
        return userTotals.sorted { $0.value > $1.value }.map { (userId: $0.key, total: $0.value) }
    }

    private func displayName(for userId: String) -> String {
        viewModel.members.first(where: { $0.id == userId })?.displayName ?? userId
    }

    private func raceName(for raceId: String) -> String {
        viewModel.races.first(where: { $0.id == raceId })?.name ?? raceId
    }

    private static let gold = Color(red: 212 / 255, green: 175 / 255, blue: 55 / 255)
    private static let silver = Color(red: 200 / 255, green: 200 / 255, blue: 188 / 255)
    private static let bronze = Color(red: 180 / 255, green: 130 / 255, blue: 70 / 255)

    private func payoutBackground(for rank: Int) -> Color {
        switch rank {
        case 1: return Self.gold.opacity(colorScheme == .dark ? 0.22 : 0.18)
        case 2: return Self.silver.opacity(colorScheme == .dark ? 0.2 : 0.16)
        case 3: return Self.bronze.opacity(colorScheme == .dark ? 0.2 : 0.16)
        default: return NASCARTheme.secondarySurface(for: colorScheme)
        }
    }

}
