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
    /// Weekly scores for the live/home race (all members). Fed by a race-scoped listener.
    @Published var liveWeeklyScores: [WeeklyScoreItem] = []
    /// Weekly scores for the currently selected race (all members). Fed by a race-scoped listener.
    @Published var selectedRaceWeeklyScores: [WeeklyScoreItem] = []

    @Published var selectedRaceId: String?
    @Published var selectedRacePoints: [(String, Int)] = []
    @Published var selectedRacePointsDocument: RacePointsDocument = .empty
    @Published var selectedRaceAdjustments: [AdjustmentItem] = []
    @Published var selectedRaceScore: WeeklyScoreItem?
    @Published var selectedRacePick: PickItem?
    @Published var selectedRacePicks: [PickItem] = []
    @Published var liveRacePicks: [PickItem] = []

    @Published var liveRacePointsDocument: RacePointsDocument = .empty
    @Published var latestStandingsSnapshot: StandingsSnapshotItem?
    @Published var notifications: [UserNotificationItem] = []

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
    private var seasonScoresListener: ListenerRegistration?
    private var allWeeklyScoresListener: ListenerRegistration?
    private var racePointsListener: ListenerRegistration?
    private var raceScoreListener: ListenerRegistration?
    private var selectedRacePickListener: ListenerRegistration?
    private var selectedRacePicksListener: ListenerRegistration?
    private var liveRacePointsListener: ListenerRegistration?
    private var liveRacePicksListener: ListenerRegistration?
    private var liveWeeklyScoresListener: ListenerRegistration?
    private var selectedRaceWeeklyScoresListener: ListenerRegistration?
    /// Set true while HomeView is on screen. liveRacePicks is only consumed by Home.
    private var wantsLiveRacePicks: Bool = false
    private var liveRacePicksUnlockTimer: Timer?
    private var standingsSnapshotListener: ListenerRegistration?
    private var adjustmentsListener: ListenerRegistration?
    private var notificationsListener: ListenerRegistration?
    private var autoFocusedRaceId: String?

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

    private func preferredRaceId(in races: [RaceItem], now: Date = Date()) -> String? {
        if let live = races.first(where: { $0.status == .locked }) {
            return live.id
        }
        if let inProgressScheduled = races.first(where: { $0.status == .scheduled && $0.lockTime <= now }) {
            return inProgressScheduled.id
        }
        if let latestCompleted = races.last(where: { $0.status == .completed }) {
            return latestCompleted.id
        }
        if let upcoming = races.first(where: { $0.status == .scheduled && $0.lockTime.timeIntervalSince(now) > 0 }) {
            return upcoming.id
        }
        return races.first?.id
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

    /// Selected race driver position map (finish position first, otherwise running position).
    var selectedRacePositionByDriverId: [String: Int] {
        var map: [String: Int] = [:]
        for d in selectedRacePointsDocument.drivers {
            if let pos = d.finishPosition ?? d.runningPosition {
                map[d.driverId] = pos
            }
        }
        return map
    }

    /// Consider results final when a substantial set of mapped finish positions is present.
    var selectedRaceHasFinalResults: Bool {
        selectedRacePointsDocument.drivers.filter { $0.finishPosition != nil }.count >= 20
    }

    /// Selected race results with adjustments applied (driverId -> final points).
    var selectedRacePointsWithAdjustments: [(String, Int)] {
        let adjByDriver = Dictionary(selectedRaceAdjustments.map { ($0.driverId, $0.deltaPoints) }, uniquingKeysWith: +)
        var pointsByDriver: [String: Int] = [:]

        for (driverId, basePoints) in selectedRacePoints {
            pointsByDriver[driverId] = basePoints + (adjByDriver[driverId] ?? 0)
        }

        for score in selectedRaceWeeklyScores {
            for item in score.breakdown where pointsByDriver[item.driverId] == nil {
                pointsByDriver[item.driverId] = item.finalPointsApplied
            }
        }

        for item in selectedRaceScore?.breakdown ?? [] where pointsByDriver[item.driverId] == nil {
            pointsByDriver[item.driverId] = item.finalPointsApplied
        }

        return pointsByDriver.sorted { $0.value > $1.value }.map { ($0.key, $0.value) }
    }

    var selectedRace: RaceItem? {
        guard let selectedRaceId else {
            guard let preferredRaceId = preferredRaceId(in: races) else { return nil }
            return races.first(where: { $0.id == preferredRaceId })
        }
        return races.first(where: { $0.id == selectedRaceId })
    }

    var canSeeAllPicksForSelectedRace: Bool {
        guard let race = selectedRace else { return false }
        if isAdmin { return true }
        if race.status == .completed { return true }
        return race.startTime <= Date()
    }

    var canSeeAllLiveRacePicks: Bool {
        guard let race = effectiveLiveRace else { return false }
        if race.status == .completed { return true }
        return race.startTime <= Date()
    }

    /// Driver points map for the currently live race.
    var liveRacePointsByDriverId: [String: Int] {
        var map = Dictionary(uniqueKeysWithValues: liveRacePointsDocument.drivers.map { ($0.driverId, $0.basePoints) })
        // Fallback for drivers not present in live feed yet.
        for score in liveWeeklyScores {
            for item in score.breakdown where map[item.driverId] == nil {
                map[item.driverId] = item.finalPointsApplied
            }
        }
        return map
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
        // Preserve standings-listener state across league switches so the
        // user doesn't see a blank Standings tab when they swap leagues
        // while it's already on screen. .onAppear won't refire because the
        // view stays mounted; we re-attach explicitly below.
        let wasObservingStandings = seasonScoresListener != nil || allWeeklyScoresListener != nil
        clearListeners()

        guard let userId = currentUserId,
              let pair = memberships.first(where: { $0.0.id == leagueId }) else {
            return
        }

        selectedLeague = pair.0
        selectedMember = pair.1
        selectedRaceId = nil
        autoFocusedRaceId = nil

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

            let preferredRaceId = self.preferredRaceId(in: races)
            let selectedRaceIsMissing = self.selectedRaceId.flatMap { selectedId in
                races.first(where: { $0.id == selectedId })
            } == nil

            if self.selectedRaceId == nil || selectedRaceIsMissing {
                self.selectedRaceId = preferredRaceId
                self.autoFocusedRaceId = preferredRaceId
            } else if preferredRaceId != nil, preferredRaceId != self.autoFocusedRaceId {
                // Race state advanced (e.g., live -> completed), so follow the new race.
                self.selectedRaceId = preferredRaceId
                self.autoFocusedRaceId = preferredRaceId
            }
            self.observeTierAndPick()
            self.observeSelectedRaceDetails()
            self.observeLiveRacePoints()
            self.observeLiveWeeklyScores()
            self.observeLiveRacePicks()
            self.observeStandingsSnapshot()
        })

        listeners.append(repository.observeDrivers(leagueId: leagueId) { [weak self] drivers in
            self?.drivers = drivers
        })

        listeners.append(repository.observeMembers(leagueId: leagueId) { [weak self] members in
            self?.members = members
        })

        // seasonScores + allWeeklyScores are attached on demand via
        // begin/endObservingStandings, called from StandingsView's
        // .onAppear / .onDisappear. They are only consumed by StandingsView.

        observeTierAndPick()
        observeSelectedRaceDetails()
        observeLiveRacePoints()
        observeLiveWeeklyScores()
        observeLiveRacePicks()
        observeStandingsSnapshot()
        observeNotifications()
        if wasObservingStandings {
            beginObservingStandings()
        }
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

    func syncLiveRaceNow(completion: @escaping (Result<LiveRaceSyncResult, Error>) -> Void) {
        guard let leagueId = selectedLeague?.id else {
            completion(.failure(NSError(domain: "PlayerViewModel", code: -1, userInfo: [NSLocalizedDescriptionKey: "No league selected"])))
            return
        }
        repository.syncLiveRaceNow(leagueId: leagueId, completion: completion)
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

    func setMemberPaidStatus(userId: String, paidStatus: PaidStatus, completion: @escaping (Result<Void, Error>) -> Void) {
        guard let leagueId = selectedLeague?.id else {
            completion(.failure(NSError(domain: "PlayerViewModel", code: -1, userInfo: [NSLocalizedDescriptionKey: "No league selected"])))
            return
        }
        repository.setMemberPaidStatus(
            leagueId: leagueId,
            userId: userId,
            paidStatus: paidStatus.rawValue,
            completion: completion
        )
    }

    func submitAdjustment(
        raceId: String,
        driverId: String,
        type: String,
        deltaPoints: Int,
        reason: String,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        guard let leagueId = selectedLeague?.id else {
            completion(.failure(NSError(domain: "PlayerViewModel", code: -1, userInfo: [NSLocalizedDescriptionKey: "No league selected"])))
            return
        }
        repository.submitAdjustment(
            leagueId: leagueId,
            raceId: raceId,
            driverId: driverId,
            type: type,
            deltaPoints: deltaPoints,
            reason: reason,
            completion: completion
        )
    }

    func manualUpsertRacePoints(
        raceId: String,
        driverPoints: [(driverId: String, basePoints: Int)],
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        guard let leagueId = selectedLeague?.id else {
            completion(.failure(NSError(domain: "PlayerViewModel", code: -1, userInfo: [NSLocalizedDescriptionKey: "No league selected"])))
            return
        }
        repository.manualUpsertRacePoints(
            leagueId: leagueId,
            raceId: raceId,
            driverPoints: driverPoints,
            completion: completion
        )
    }

    func markNotificationRead(_ notificationId: String) {
        guard let userId = currentUserId else { return }
        repository.markNotificationRead(userId: userId, notificationId: notificationId) { _ in }
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

    /// Observes weekly scores (all members) for the current live race. Replaces
    /// the previous derivation over the full-league `allWeeklyScores` listener.
    private func observeLiveWeeklyScores() {
        liveWeeklyScoresListener?.remove()
        liveWeeklyScoresListener = nil
        guard let leagueId = selectedLeague?.id, let raceId = effectiveLiveRace?.id else {
            liveWeeklyScores = []
            return
        }
        liveWeeklyScoresListener = repository.observeRaceWeeklyScores(leagueId: leagueId, raceId: raceId) { [weak self] items in
            self?.liveWeeklyScores = items
        }
    }

    private func observeLiveRacePicks() {
        liveRacePicksListener?.remove()
        liveRacePicksListener = nil
        liveRacePicksUnlockTimer?.invalidate()
        liveRacePicksUnlockTimer = nil
        guard wantsLiveRacePicks,
              let leagueId = selectedLeague?.id,
              let race = effectiveLiveRace else {
            liveRacePicks = []
            return
        }
        let raceId = race.id
        guard canSeeAllLiveRacePicks else {
            liveRacePicks = []
            let unlockDelay = race.startTime.timeIntervalSinceNow
            if unlockDelay > 0 {
                liveRacePicksUnlockTimer = Timer.scheduledTimer(
                    withTimeInterval: unlockDelay + 0.5,
                    repeats: false
                ) { [weak self] _ in
                    Task { @MainActor [weak self] in
                        guard let self else { return }
                        self.liveRacePicksUnlockTimer = nil
                        self.observeLiveRacePicks()
                    }
                }
                liveRacePicksUnlockTimer?.tolerance = 1
            }
            return
        }
        liveRacePicksListener = repository.observeRacePicks(leagueId: leagueId, raceId: raceId) { [weak self] picks in
            self?.liveRacePicks = picks
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
        selectedRacePicksListener?.remove()
        selectedRaceWeeklyScoresListener?.remove()
        adjustmentsListener?.remove()
        racePointsListener = nil
        raceScoreListener = nil
        selectedRacePickListener = nil
        selectedRacePicksListener = nil
        selectedRaceWeeklyScoresListener = nil
        adjustmentsListener = nil

        guard let leagueId = selectedLeague?.id,
              let raceId = selectedRaceId,
              let userId = currentUserId else {
            selectedRacePoints = []
            selectedRacePointsDocument = .empty
            selectedRacePick = nil
            selectedRaceAdjustments = []
            selectedRacePicks = []
            selectedRaceWeeklyScores = []
            return
        }

        racePointsListener = repository.observeRacePointsDocument(leagueId: leagueId, raceId: raceId) { [weak self] document in
            self?.selectedRacePointsDocument = document
            self?.selectedRacePoints = document.drivers
                .map { ($0.driverId, $0.basePoints) }
                .sorted { $0.1 > $1.1 }
        }

        raceScoreListener = repository.observeWeeklyScore(leagueId: leagueId, raceId: raceId, userId: userId) { [weak self] score in
            self?.selectedRaceScore = score
        }

        selectedRacePickListener = repository.observePick(leagueId: leagueId, raceId: raceId, userId: userId) { [weak self] pick in
            self?.selectedRacePick = pick
        }

        if canSeeAllPicksForSelectedRace {
            selectedRacePicksListener = repository.observeRacePicks(leagueId: leagueId, raceId: raceId) { [weak self] picks in
                self?.selectedRacePicks = picks
            }
        } else {
            selectedRacePicks = []
        }

        selectedRaceWeeklyScoresListener = repository.observeRaceWeeklyScores(leagueId: leagueId, raceId: raceId) { [weak self] items in
            self?.selectedRaceWeeklyScores = items
        }

        adjustmentsListener = repository.observeAdjustments(leagueId: leagueId, raceId: raceId) { [weak self] items in
            self?.selectedRaceAdjustments = items
        }
    }

    private func observeNotifications() {
        notificationsListener?.remove()
        notificationsListener = nil
        guard let userId = currentUserId else {
            notifications = []
            return
        }
        notificationsListener = repository.observeNotifications(userId: userId) { [weak self] items in
            self?.notifications = items
        }
    }

    /// Attach seasonScores + allWeeklyScores listeners. Idempotent — safe to
    /// call on every StandingsView.onAppear. Call endObservingStandings from
    /// .onDisappear to detach.
    func beginObservingStandings() {
        guard let leagueId = selectedLeague?.id else { return }
        if seasonScoresListener == nil {
            seasonScoresListener = repository.observeSeasonScores(leagueId: leagueId) { [weak self] scores in
                self?.seasonScores = scores
            }
        }
        if allWeeklyScoresListener == nil {
            allWeeklyScoresListener = repository.observeAllWeeklyScores(leagueId: leagueId) { [weak self] scores in
                self?.allWeeklyScores = scores
            }
        }
    }

    func endObservingStandings() {
        seasonScoresListener?.remove()
        seasonScoresListener = nil
        allWeeklyScoresListener?.remove()
        allWeeklyScoresListener = nil
    }

    /// Attach the live race picks listener. Only HomeView consumes liveRacePicks,
    /// so it's gated by Home visibility via begin/endObservingLiveRacePicks.
    func beginObservingLiveRacePicks() {
        wantsLiveRacePicks = true
        observeLiveRacePicks()
    }

    func endObservingLiveRacePicks() {
        wantsLiveRacePicks = false
        liveRacePicksListener?.remove()
        liveRacePicksListener = nil
        liveRacePicksUnlockTimer?.invalidate()
        liveRacePicksUnlockTimer = nil
        liveRacePicks = []
    }

    private func clearListeners() {
        listeners.forEach { $0.remove() }
        listeners.removeAll()
        tierListener?.remove()
        pickListener?.remove()
        seasonScoresListener?.remove()
        allWeeklyScoresListener?.remove()
        racePointsListener?.remove()
        raceScoreListener?.remove()
        selectedRacePickListener?.remove()
        selectedRacePicksListener?.remove()
        selectedRaceWeeklyScoresListener?.remove()
        liveRacePointsListener?.remove()
        liveRacePicksListener?.remove()
        liveWeeklyScoresListener?.remove()
        liveRacePicksUnlockTimer?.invalidate()
        standingsSnapshotListener?.remove()
        adjustmentsListener?.remove()
        notificationsListener?.remove()
        tierListener = nil
        pickListener = nil
        seasonScoresListener = nil
        allWeeklyScoresListener = nil
        racePointsListener = nil
        raceScoreListener = nil
        selectedRacePickListener = nil
        selectedRacePicksListener = nil
        selectedRaceWeeklyScoresListener = nil
        liveRacePointsListener = nil
        liveRacePicksListener = nil
        liveWeeklyScoresListener = nil
        liveRacePicksUnlockTimer = nil
        standingsSnapshotListener = nil
        adjustmentsListener = nil
        notificationsListener = nil
        autoFocusedRaceId = nil
        liveWeeklyScores = []
        selectedRaceWeeklyScores = []
    }
}
