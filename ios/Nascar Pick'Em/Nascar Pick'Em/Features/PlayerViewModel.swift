import Foundation
import Combine
import FirebaseAuth
import FirebaseFirestore

@MainActor
final class PlayerViewModel: ObservableObject {
    @Published var memberships: [(LeagueSummary, LeagueMember)] = []
    @Published var selectedLeague: LeagueSummary?
    @Published var selectedMember: LeagueMember?

    @Published var races: [RaceItem] = []
    @Published var drivers: [DriverItem] = []
    @Published var tier: TierItem?
    @Published var currentPick: PickItem?

    @Published var seasonScores: [SeasonScoreItem] = []
    @Published var members: [LeagueMember] = []
    @Published var allWeeklyScores: [WeeklyScoreItem] = []

    @Published var selectedRaceId: String?
    @Published var selectedRacePoints: [(String, Int)] = []
    @Published var selectedRaceAdjustments: [AdjustmentItem] = []
    @Published var selectedRaceScore: WeeklyScoreItem?
    @Published var selectedRacePick: PickItem?

    @Published var liveRacePointsDocument: RacePointsDocument = .empty
    @Published var latestStandingsSnapshot: StandingsSnapshotItem?

    @Published var isLoading = false
    @Published var isSavingPick = false
    @Published var errorMessage: String?
    @Published var statusMessage: String?

    /// League member names for the join flow (from league preview).
    @Published var memberNamesForJoin: [String] = []
    @Published var leaguePreviewLoadingForJoin = false

    private let repository = LeagueRepository.shared
    private var listeners: [ListenerRegistration] = []
    private var tierListener: ListenerRegistration?
    private var pickListener: ListenerRegistration?
    private var allWeeklyScoresListener: ListenerRegistration?
    private var racePointsListener: ListenerRegistration?
    private var raceScoreListener: ListenerRegistration?
    private var selectedRacePickListener: ListenerRegistration?
    private var liveRacePointsListener: ListenerRegistration?
    private var standingsSnapshotListener: ListenerRegistration?
    private var adjustmentsListener: ListenerRegistration?

    var currentUserId: String? {
        Auth.auth().currentUser?.uid
    }

    var upcomingRace: RaceItem? {
        races.first { race in
            race.status == .scheduled && race.lockTime.timeIntervalSinceNow > 0
        } ?? races.first { $0.status == .scheduled }
    }

    /// Race currently in progress (picks locked, results may be updating).
    var liveRace: RaceItem? {
        races.first { $0.status == .locked }
    }

    /// Scheduled race whose lock time has already passed.
    var inProgressScheduledRace: RaceItem? {
        races.first { $0.status == .scheduled && $0.lockTime <= Date() }
    }

    /// Race in progress for live UI.
    var effectiveLiveRace: RaceItem? {
        liveRace ?? inProgressScheduledRace
    }

    /// 10pm Eastern on the calendar day after the race start (web logic).
    private var nextDay10pmETAfterLatestCompleted: Date? {
        guard let last = races.last(where: { $0.status == .completed }) else { return nil }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "America/New_York")!
        var comps = cal.dateComponents([.year, .month, .day], from: last.startTime)
        comps.day! += 1
        comps.hour = 22
        comps.minute = 0
        comps.second = 0
        return cal.date(from: comps)
    }

    /// Race we show for picks/Home. Prefer in-progress, then just-completed until 10pm ET next day, then next upcoming.
    var primaryRace: RaceItem? {
        if let live = effectiveLiveRace { return live }
        if let latest = races.last(where: { $0.status == .completed }),
           let cutoff = nextDay10pmETAfterLatestCompleted,
           Date() < cutoff {
            return latest
        }
        return upcomingRace
    }

    /// Live weekly scores for the current live race (sorted by weeklyTotal desc).
    var liveWeeklyScores: [WeeklyScoreItem] {
        guard let raceId = effectiveLiveRace?.id else { return [] }
        return allWeeklyScores
            .filter { $0.raceId == raceId }
            .sorted { $0.weeklyTotal > $1.weeklyTotal }
    }

    /// When race is live, driverId -> current running position for picks UI.
    var driverPositionByDriverId: [String: Int] {
        var map: [String: Int] = [:]
        for d in liveRacePointsDocument.drivers {
            if let pos = d.runningPosition { map[d.driverId] = pos }
        }
        return map
    }

    /// Tiers computed from latest standings snapshot (when tier doc is missing).
    var tiersFromStandingsSnapshot: TierItem? {
        guard let snapshot = latestStandingsSnapshot, !snapshot.drivers.isEmpty else { return nil }
        let ordered = snapshot.drivers.sorted { $0.position < $1.position }
        let tierA = ordered.filter { $0.position >= 1 && $0.position <= 10 }.map(\.driverId)
        let tierB = ordered.filter { $0.position >= 11 && $0.position <= 20 }.map(\.driverId)
        let tierC = ordered.filter { $0.position >= 21 && $0.position <= 30 }.map(\.driverId)
        if tierA.isEmpty && tierB.isEmpty && tierC.isEmpty { return nil }
        return TierItem(tierA: tierA, tierB: tierB, tierC: tierC)
    }

    /// Tier to use: doc first, else from standings snapshot.
    var effectiveTier: TierItem? {
        tier ?? tiersFromStandingsSnapshot
    }

    /// Selected race results with adjustments applied (driverId -> final points).
    var selectedRacePointsWithAdjustments: [(String, Int)] {
        let adjByDriver = Dictionary(selectedRaceAdjustments.map { ($0.driverId, $0.deltaPoints) }, uniquingKeysWith: +)
        var pointsByDriver: [String: Int] = [:]

        for (driverId, basePoints) in selectedRacePoints {
            pointsByDriver[driverId] = basePoints + (adjByDriver[driverId] ?? 0)
        }

        if let raceId = selectedRaceId {
            for score in allWeeklyScores where score.raceId == raceId {
                for item in score.breakdown where pointsByDriver[item.driverId] == nil {
                    pointsByDriver[item.driverId] = item.finalPointsApplied
                }
            }
        }

        for item in selectedRaceScore?.breakdown ?? [] where pointsByDriver[item.driverId] == nil {
            pointsByDriver[item.driverId] = item.finalPointsApplied
        }

        return pointsByDriver.sorted { $0.value > $1.value }.map { ($0.key, $0.value) }
    }

    var selectedRace: RaceItem? {
        guard let selectedRaceId else {
            return races.last(where: { $0.status == .completed }) ?? upcomingRace
        }
        return races.first(where: { $0.id == selectedRaceId })
    }

    var isPickLocked: Bool {
        guard let primaryRace else {
            return true
        }
        return primaryRace.status != .scheduled || primaryRace.lockTime <= Date()
    }

    var driversById: [String: DriverItem] {
        Dictionary(uniqueKeysWithValues: drivers.map { ($0.id, $0) })
    }

    func loadMemberships() {
        guard let userId = currentUserId else {
            memberships = []
            selectedLeague = nil
            selectedMember = nil
            return
        }

        isLoading = true
        repository.fetchMemberships(userId: userId) { [weak self] result in
            guard let self else { return }
            self.isLoading = false
            switch result {
            case .success(let entries):
                self.memberships = entries
                if let first = entries.first {
                    self.applyLeagueSelection(leagueId: first.0.id)
                }
            case .failure(let error):
                self.errorMessage = error.localizedDescription
            }
        }
    }

    func applyLeagueSelection(leagueId: String) {
        clearListeners()

        guard let userId = currentUserId,
              let pair = memberships.first(where: { $0.0.id == leagueId }) else {
            return
        }

        selectedLeague = pair.0
        selectedMember = pair.1

        listeners.append(repository.observeLeague(leagueId: leagueId) { [weak self] league in
            guard let self, let league else { return }
            self.selectedLeague = league
        })

        listeners.append(repository.observeMember(leagueId: leagueId, userId: userId) { [weak self] member in
            guard let self else { return }
            self.selectedMember = member
        })

        listeners.append(repository.observeRaces(leagueId: leagueId) { [weak self] races in
            guard let self else { return }
            self.races = races
            if self.selectedRaceId == nil {
                self.selectedRaceId = races.last(where: { $0.status == .completed })?.id ?? races.first?.id
            }
            self.observeTierAndPick()
            self.observeSelectedRaceDetails()
            self.observeLiveRacePoints()
            self.observeStandingsSnapshot()
        })

        listeners.append(repository.observeDrivers(leagueId: leagueId) { [weak self] drivers in
            self?.drivers = drivers
        })

        listeners.append(repository.observeMembers(leagueId: leagueId) { [weak self] members in
            self?.members = members
        })

        listeners.append(repository.observeSeasonScores(leagueId: leagueId) { [weak self] scores in
            self?.seasonScores = scores
        })

        allWeeklyScoresListener = repository.observeAllWeeklyScores(leagueId: leagueId) { [weak self] scores in
            self?.allWeeklyScores = scores
        }

        observeTierAndPick()
        observeSelectedRaceDetails()
        observeLiveRacePoints()
        observeStandingsSnapshot()
    }

    /// Fetches league preview (member names) for the join flow when user enters invite code.
    func fetchLeaguePreviewForJoin(inviteCode: String) {
        let code = inviteCode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if code.count < 2 {
            memberNamesForJoin = []
            leaguePreviewLoadingForJoin = false
            return
        }
        leaguePreviewLoadingForJoin = true
        repository.getLeaguePreview(inviteCode: code) { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                self.leaguePreviewLoadingForJoin = false
                switch result {
                case .success(let preview):
                    self.memberNamesForJoin = preview.memberNames
                case .failure:
                    self.memberNamesForJoin = []
                }
            }
        }
    }

    func joinLeague(inviteCode: String, displayName: String) {
        isLoading = true
        repository.joinLeague(inviteCode: inviteCode, displayName: displayName) { [weak self] result in
            guard let self else { return }
            self.isLoading = false
            switch result {
            case .success:
                self.statusMessage = "Joined league successfully."
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                    self.loadMemberships()
                }
            case .failure(let error):
                self.errorMessage = error.localizedDescription
            }
        }
    }

    func createLeague(name: String, seasonYear: Int, inviteCode: String, payoutConfigText: String) {
        isLoading = true
        repository.createLeague(
            name: name,
            seasonYear: seasonYear,
            inviteCode: inviteCode,
            payoutConfigText: payoutConfigText
        ) { [weak self] result in
            guard let self else { return }
            self.isLoading = false
            switch result {
            case .success:
                self.statusMessage = "League created successfully."
                self.loadMemberships()
            case .failure(let error):
                self.errorMessage = error.localizedDescription
            }
        }
    }

    func setSelectedRace(raceId: String) {
        selectedRaceId = raceId
        observeSelectedRaceDetails()
    }

    func savePick(tierA: [String], tierB: [String], tierC: [String]) {
        guard let leagueId = selectedLeague?.id,
              let raceId = primaryRace?.id else {
            return
        }

        isSavingPick = true
        repository.savePick(
            leagueId: leagueId,
            raceId: raceId,
            tierA: tierA,
            tierB: tierB,
            tierC: tierC
        ) { [weak self] result in
            guard let self else { return }
            self.isSavingPick = false
            switch result {
            case .success:
                self.statusMessage = "Picks saved."
            case .failure(let error):
                self.errorMessage = error.localizedDescription
            }
        }
    }

    func clearMessages() {
        errorMessage = nil
        statusMessage = nil
    }

    var isAdmin: Bool {
        selectedMember?.role == .admin
    }

    func runManualRefresh(completion: @escaping (Result<Void, Error>) -> Void) {
        guard let leagueId = selectedLeague?.id else {
            completion(.failure(NSError(domain: "PlayerViewModel", code: -1, userInfo: [NSLocalizedDescriptionKey: "No league selected"])))
            return
        }
        repository.runManualRefresh(leagueId: leagueId, completion: completion)
    }

    func setLeagueSettings(name: String, seasonYear: Int, payoutConfigText: String, completion: @escaping (Result<Void, Error>) -> Void) {
        guard let leagueId = selectedLeague?.id else {
            completion(.failure(NSError(domain: "PlayerViewModel", code: -1, userInfo: [NSLocalizedDescriptionKey: "No league selected"])))
            return
        }
        repository.setLeagueSettings(leagueId: leagueId, name: name, seasonYear: seasonYear, payoutConfigText: payoutConfigText) { [weak self] result in
            if case .success = result, let league = self?.selectedLeague {
                self?.selectedLeague = LeagueSummary(
                    id: league.id,
                    name: name,
                    seasonYear: seasonYear,
                    inviteCode: league.inviteCode,
                    payoutConfigText: payoutConfigText,
                    memberNames: league.memberNames
                )
            }
            completion(result)
        }
    }

    private func observeTierAndPick() {
        tierListener?.remove()
        pickListener?.remove()
        tierListener = nil
        pickListener = nil

        guard let leagueId = selectedLeague?.id,
              let raceId = primaryRace?.id,
              let userId = currentUserId else {
            return
        }

        tierListener = repository.observeTier(leagueId: leagueId, raceId: raceId) { [weak self] tier in
            self?.tier = tier
        }

        pickListener = repository.observePick(leagueId: leagueId, raceId: raceId, userId: userId) { [weak self] pick in
            self?.currentPick = pick
        }
    }

    private func observeLiveRacePoints() {
        liveRacePointsListener?.remove()
        liveRacePointsListener = nil
        guard let leagueId = selectedLeague?.id, let raceId = effectiveLiveRace?.id else {
            liveRacePointsDocument = .empty
            return
        }
        liveRacePointsListener = repository.observeRacePointsDocument(leagueId: leagueId, raceId: raceId) { [weak self] doc in
            self?.liveRacePointsDocument = doc
        }
    }

    private func observeStandingsSnapshot() {
        standingsSnapshotListener?.remove()
        standingsSnapshotListener = nil
        guard let leagueId = selectedLeague?.id else {
            latestStandingsSnapshot = nil
            return
        }
        standingsSnapshotListener = repository.observeLatestStandingsSnapshot(leagueId: leagueId) { [weak self] snapshot in
            self?.latestStandingsSnapshot = snapshot
        }
    }

    private func observeSelectedRaceDetails() {
        racePointsListener?.remove()
        raceScoreListener?.remove()
        selectedRacePickListener?.remove()
        adjustmentsListener?.remove()
        racePointsListener = nil
        raceScoreListener = nil
        selectedRacePickListener = nil
        adjustmentsListener = nil

        guard let leagueId = selectedLeague?.id,
              let raceId = selectedRaceId,
              let userId = currentUserId else {
            selectedRacePick = nil
            selectedRaceAdjustments = []
            return
        }

        racePointsListener = repository.observeRacePoints(leagueId: leagueId, raceId: raceId) { [weak self] points in
            self?.selectedRacePoints = points
        }

        raceScoreListener = repository.observeWeeklyScore(leagueId: leagueId, raceId: raceId, userId: userId) { [weak self] score in
            self?.selectedRaceScore = score
        }

        selectedRacePickListener = repository.observePick(leagueId: leagueId, raceId: raceId, userId: userId) { [weak self] pick in
            self?.selectedRacePick = pick
        }

        adjustmentsListener = repository.observeAdjustments(leagueId: leagueId, raceId: raceId) { [weak self] items in
            self?.selectedRaceAdjustments = items
        }
    }

    private func clearListeners() {
        listeners.forEach { $0.remove() }
        listeners.removeAll()
        tierListener?.remove()
        pickListener?.remove()
        allWeeklyScoresListener?.remove()
        racePointsListener?.remove()
        raceScoreListener?.remove()
        selectedRacePickListener?.remove()
        liveRacePointsListener?.remove()
        standingsSnapshotListener?.remove()
        adjustmentsListener?.remove()
        tierListener = nil
        pickListener = nil
        allWeeklyScoresListener = nil
        racePointsListener = nil
        raceScoreListener = nil
        selectedRacePickListener = nil
        liveRacePointsListener = nil
        standingsSnapshotListener = nil
        adjustmentsListener = nil
    }
}
