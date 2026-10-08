extends RefCounted
## Asks several backends the same questions: each line of the recorded session
## (tools/session.gd), in the game state where the session types it.
##
## The route is walked by the moves the lines mean, whatever the answers, so a
## miss doesn't change the questions that follow. Unlike the session, nothing
## is retried: a line lands on its first answer or not at all.

const Session := preload("res://tools/session.gd")
const World := preload("res://demo/world.gd")
const JevNode := preload("res://addons/jev/jev.gd")
const WORLD := "res://demo/world.json"


## The backends to compare, name -> HttpDecider settings: TypeSafe Jev and the
## Open Jev server at OPENJEV_URL, then one more Open Jev server for each
## `--openjev name=url`. Returns {} when one of those can't be read.
static func backends(args: PackedStringArray, env: Dictionary) -> Dictionary:
	var out := {"typesafe": JevNode.backend_config("typesafe", env), "openjev": JevNode.backend_config("openjev", env)}
	for i in args.size():
		if args[i] != "--openjev":
			continue
		var spec := args[i + 1].split("=", true, 1) if i + 1 < args.size() else PackedStringArray()
		if spec.size() != 2 or spec[0].is_empty() or spec[1].is_empty() or out.has(spec[0]):
			return {}
		var config := JevNode.backend_config("openjev", {"OPENJEV_URL": spec[1], "OPENJEV_TOKEN": env.get("OPENJEV_TOKEN", "")})
		config.label = "Open Jev %s" % spec[0]
		out[spec[0]] = config
	return out


## `parsers` maps a backend name to a Parser. Returns one row per line, round
## and backend, asked in that order.
static func play(parsers: Dictionary, rounds: int) -> Array:
	var world := World.from_file(WORLD)
	var rows := []
	for line in Session.LINES:
		for round in rounds:
			for backend in parsers:
				var started := Time.get_ticks_usec()
				var result: Dictionary = await parsers[backend].parse(line.say, world)
				var ms := int((Time.get_ticks_usec() - started) / 1000)
				rows.append(_row(backend, round, line, world.room, result, ms))
		if not line.means.is_empty():
			world.apply(line.means)
	return rows


static func _row(backend: String, round: int, line: Dictionary, room: String, result: Dictionary, ms: int) -> Dictionary:
	var stats: Dictionary = result.get("stats", {})
	var ranked: Array = stats.get("ranked", [])
	return {
		"backend": backend, "round": round, "say": line.say, "means": line.means, "room": room,
		"kind": result.kind, "action": result.get("action", ""),
		"options": result.get("options", []).map(func(o): return o.id),
		"confidence": result.get("confidence", 0.0), "ms": ms,
		"top": ranked[0][0] if not ranked.is_empty() else "", "ranked": ranked,
		"offered": stats.get("offered", 0),
		"model": stats.get("model", ""), "reason": result.get("reason", ""),
		"landed": landed(line.means, result),
	}


## A line lands on the move it means, or on a clarify that offers it. A line
## that means nothing lands on unknown.
static func landed(means: String, result: Dictionary) -> bool:
	match result.kind:
		"act":
			return result.action == means and not means.is_empty()
		"clarify":
			return result.options.any(func(o): return o.id == means) and not means.is_empty()
		"unknown":
			return means.is_empty()
	return false


static func summary(rows: Array, backend: String) -> Dictionary:
	var mine := rows.filter(func(r): return r.backend == backend)
	var out := {"turns": mine.size(), "landed": mine.filter(func(r): return r.landed).size()}
	for kind in ["act", "clarify", "unknown", "error"]:
		out[kind] = mine.filter(func(r): return r.kind == kind).size()
	var ms := mine.map(func(r): return r.ms)
	out.p50_ms = percentile(ms, 50)
	out.p95_ms = percentile(ms, 95)
	out.max_ms = percentile(ms, 100)
	return out


## [same, total]: how often two backends ranked the same move first, over the
## lines and rounds both answered.
static func agreement(rows: Array, a: String, b: String) -> Array:
	var b_tops := {}
	for r in rows:
		if r.backend == b and not r.top.is_empty():
			b_tops["%d|%s" % [r.round, r.say]] = r.top
	var same := 0
	var total := 0
	for r in rows:
		var key := "%d|%s" % [r.round, r.say]
		if r.backend == a and not r.top.is_empty() and b_tops.has(key):
			total += 1
			same += int(b_tops[key] == r.top)
	return [same, total]


## agreement() for every pair of `names`, keyed "a|b".
static func agreements(rows: Array, names: Array) -> Dictionary:
	var out := {}
	for i in names.size():
		for j in range(i + 1, names.size()):
			out["%s|%s" % [names[i], names[j]]] = agreement(rows, names[i], names[j])
	return out


## Nearest rank: the smallest value with at least p% of values at or below it.
static func percentile(values: Array, p: float) -> int:
	if values.is_empty():
		return 0
	var sorted := values.duplicate()
	sorted.sort()
	var rank := maxi(1, ceili(p / 100.0 * sorted.size()))
	return int(sorted[rank - 1])
