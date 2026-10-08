extends SceneTree
## Builds docs/godot-jev/data.js from godot-jev's recorded three-model run.
##
##   godot --headless --path godot-jev --script ../docs/tools/build-godot-jev-data.gd
##
## Every number the results page shows comes from here. Each recorded answer is
## replayed through the game's own parser (demo/parser.gd) in the game state
## where it was asked, first at the thresholds the run used, where it has to
## give the outcome the run recorded, then at every other threshold the page's
## sliders can reach. The page only draws the result. Summaries are recomputed
## with eval/compare.gd and checked against the ones the run saved.

const Compare := preload("res://eval/compare.gd")
const Parser := preload("res://demo/parser.gd")
const Scripted := preload("res://addons/jev/scripted_decider.gd")

const RESULTS := "results-2026-10-08T134205.json"
const EARLIER := "results-2026-09-30T101313.json"  # the two-model run, for the latency comparison
const SURE := 0.95
const STEPS := 100  # sliders move in hundredths, 0.00 to 1.00

# In the page's order. `id` picks the colour (--m-<id> in assets/site.css).
const RUNS := [
	{
		"backend": "typesafe", "id": "typesafe", "name": "TypeSafe Jev", "short": "TypeSafe", "where": "Hosted", "size": "Hosted API",
		"note": "Pinned to jev-1.13.0. A turn's time includes the network round trip from the laptop.",
	},
	{
		"backend": "flash9b", "id": "flash", "name": "Open Jev Flash 9B", "short": "Flash 9B", "where": "Local", "size": "5 GB",
		"note": "MLX 4-bit on an Apple M5 Pro laptop, with the 27B loaded beside it.",
	},
	{
		"backend": "openjev", "id": "27b", "name": "Open Jev 27B", "short": "27B", "where": "Local", "size": "14 GB",
		"note": "MLX 4-bit on an Apple M5 Pro laptop, with Flash 9B loaded beside it.",
	},
]

var failed := false


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	var raw: Dictionary = _read("res://eval/" + RESULTS)
	var rounds := int(raw.rounds)
	var names: Array = RUNS.map(func(r): return r.backend)
	_same(names.size(), raw.backends.size(), "backends in the run")

	var by_backend := {}
	for name in names:
		by_backend[name] = raw.rows.filter(func(r): return r.backend == name)
		_same(by_backend[name].size(), Compare.Session.LINES.size() * rounds, "%s rows" % name)
		_same(Compare.summary(by_backend[name], name), _ints(raw.summary[name]), "%s summary" % name)
	for pair in raw.same_top_choice:
		var agreement := Compare.agreement(raw.rows, pair.get_slice("|", 0), pair.get_slice("|", 1))
		_same(agreement, _ints(raw.same_top_choice[pair]), "same top choice, %s" % pair)

	var world: Object = Compare.World.from_file(Compare.WORLD)
	var lines := []
	var out_rows := {}
	for name in names:
		out_rows[name] = []
	var question := ""
	var none_text := ""
	for i in Compare.Session.LINES.size():
		var line: Dictionary = Compare.Session.LINES[i]
		var asked := {}
		for name in names:
			for round in rounds:
				var row: Dictionary = by_backend[name][i * rounds + round]
				_same(row.say, line.say, "%s row %d is line %d" % [name, i * rounds + round, i + 1])
				_same(int(row.round), round, "%s line %d round" % [name, i + 1])
				_same(row.room, world.room, "%s line %d room" % [name, i + 1])
				var replayed := await _replay(row, i, world)
				asked = replayed.asked
				out_rows[name].append(replayed.row)
		question = asked.questions.action.instructions
		none_text = asked.questions.action.criteria[Parser.NONE]
		var options := []
		for id in asked.questions.action.criteria:
			if id != Parser.NONE:
				options.append({"id": id, "text": asked.questions.action.criteria[id]})
		var state: Dictionary = asked.state.duplicate()
		state.erase("player_typed")
		lines.append({
			"say": line.say, "means": line.means, "meansText": _text_of(options, line.means),
			"room": world.data.rooms[world.room].title, "state": state, "options": options,
		})
		if not line.means.is_empty():
			world.apply(line.means)

	var runs := []
	for meta in RUNS:
		var rows: Array = out_rows[meta.backend]
		var ms: Array = rows.map(func(r): return r.ms)
		var confidences: Array = rows.map(func(r): return r.confidence)
		var served: String = raw.backends[meta.backend].served
		var temperature := RegEx.create_from_string("\\bT=([\\d.]+)").search(served)
		var run: Dictionary = meta.duplicate()
		run.merge({
			"servedModel": served.get_slice(" ", 0),
			"temperature": temperature.get_string(1) if temperature else "",
			"rows": rows,
			"summary": _ints(raw.summary[meta.backend]),
			"latency": {
				"min": ms.min(), "p50": Compare.percentile(ms, 50), "mean": _mean(ms),
				"p95": Compare.percentile(ms, 95), "max": ms.max(),
			},
			"sure": confidences.filter(func(c): return c >= SURE).size(),
			"meanConfidence": _mean(confidences),
			"lowestOnAMove": rows.filter(func(r): return r.top != Parser.NONE).map(func(r): return r.confidence).min(),
			"sameEveryRound": _same_every_round(rows, rounds),
		})
		runs.append(run)

	var pairs := []
	for a in runs.size():
		for b in range(a + 1, runs.size()):
			var same_kind := 0
			for i in runs[a].rows.size():
				same_kind += int(runs[a].rows[i].kind == runs[b].rows[i].kind)
			var agree: Array = Compare.agreement(raw.rows, runs[a].backend, runs[b].backend)
			pairs.append({"a": runs[a].id, "b": runs[b].id, "sameTop": agree[0], "sameKind": same_kind, "turns": agree[1]})

	var earlier: Dictionary = _read("res://eval/" + EARLIER)
	var data := {
		"generatedFrom": "godot-jev/eval/" + RESULTS,
		"when": raw.when,
		"rounds": rounds,
		"thresholds": raw.thresholds,
		"defaultAct": roundi(raw.thresholds.act * STEPS),
		"defaultClarify": roundi(raw.thresholds.clarify * STEPS),
		"slider": range(STEPS + 1).map(func(i): return float(i) / STEPS),
		"sureAt": SURE,
		"speedCheckMs": 500,
		"none": Parser.NONE,
		"question": question,
		"noneText": none_text,
		"lines": lines,
		"runs": runs,
		"pairs": pairs,
		"earlier": {
			"when": earlier.when, "rounds": int(earlier.rounds),
			"typesafe": _ints(earlier.summary.typesafe), "27b": _ints(earlier.summary.openjev),
		},
	}
	if failed:
		print("not written: the replay differs from the recorded run")
		quit(1)
		return

	var path := ProjectSettings.globalize_path("res://").path_join("../docs/godot-jev/data.js").simplify_path()
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var file := FileAccess.open(path, FileAccess.WRITE)
	file.store_string("/* Generated by docs/tools/build-godot-jev-data.gd from godot-jev's eval run. Don't edit. */\n")
	file.store_string("window.GJ_DATA = %s;\n" % JSON.stringify(data))
	file.close()
	print("wrote %s" % path)
	for run in runs:
		var s: Dictionary = run.summary
		print("%-18s landed %d/%d  act %d  clarify %d  unknown %d  sure %d  mean confidence %.2f  p50 %d ms  p95 %d ms" % [
			run.name, s.landed, s.turns, s.act, s.clarify, s.unknown, run.sure, run.meanConfidence, s.p50_ms, s.p95_ms])
	for p in pairs:
		print("%s vs %s: same top choice %d/%d, same outcome %d/%d" % [p.a, p.b, p.sameTop, p.turns, p.sameKind, p.turns])
	quit(0)


## Puts one recorded answer to line `index` back through the parser. Returns
## the row for the page and the question the parser asked.
func _replay(row: Dictionary, index: int, world: Object) -> Dictionary:
	var line: Dictionary = Compare.Session.LINES[index]
	var probabilities := {}
	for pair in row.ranked:
		probabilities[pair[0]] = pair[1]
	var decider := Scripted.new(func(_state, _questions):
		return {"model": row.model, "answers": {"action": Scripted.choice(row.top, row.confidence, probabilities)}})
	var parser := Parser.new(decider)

	var at_run: Dictionary = await parser.parse(line.say, world)
	var ids := func(result: Dictionary) -> Array: return result.get("options", []).map(func(o): return o.id)
	var label := "%s line \"%s\" round %d" % [row.backend, line.say, int(row.round)]
	_same(at_run.kind, row.kind, label + " outcome")
	_same(at_run.get("action", ""), row.action, label + " move")
	_same(ids.call(at_run), row.options, label + " clarify options")
	_same(Compare.landed(line.means, at_run), row.landed, label + " landed")
	_same(int(at_run.stats.offered), int(row.offered), label + " options offered")

	# The highest setting of each slider at which the parser still acts, or still asks.
	var act_max := -1
	var clarify_max := -1
	var acting := {}
	var asking := {}
	parser.clarify_confidence = 0.0
	for i in STEPS + 1:
		parser.act_confidence = float(i) / STEPS
		var result: Dictionary = await parser.parse(line.say, world)
		if result.kind == "act":
			_same(i, act_max + 1, label + " acts at every lower act threshold")
			act_max = i
			acting = result
	parser.act_confidence = 2.0
	for i in STEPS + 1:
		parser.clarify_confidence = float(i) / STEPS
		var result: Dictionary = await parser.parse(line.say, world)
		if result.kind == "clarify":
			_same(i, clarify_max + 1, label + " asks at every lower clarify threshold")
			clarify_max = i
			asking = result

	return {
		"asked": decider.calls[0],
		"row": {
			"line": index, "round": int(row.round),
			"kind": row.kind, "landed": row.landed, "confidence": row.confidence, "ms": int(row.ms),
			"offered": int(row.offered), "top": row.top, "ranked": row.ranked,
			"actMax": act_max, "clarifyMax": clarify_max,
			"asks": ids.call(asking),
			"lands": {
				"act": not acting.is_empty() and Compare.landed(line.means, acting),
				"clarify": not asking.is_empty() and Compare.landed(line.means, asking),
				"unknown": Compare.landed(line.means, {"kind": "unknown"}),
			},
		},
	}


func _same_every_round(rows: Array, rounds: int) -> bool:
	for i in range(0, rows.size(), rounds):
		for round in range(1, rounds):
			if rows[i + round].confidence != rows[i].confidence or rows[i + round].ranked != rows[i].ranked:
				return false
	return true


func _text_of(options: Array, id: String) -> String:
	for o in options:
		if o.id == id:
			return o.text
	return ""


func _mean(values: Array) -> float:
	return values.reduce(func(a, b): return a + b, 0.0) / values.size()


## JSON gives every number back as a float: the run's counts and milliseconds are whole numbers.
func _ints(value: Variant) -> Variant:
	if typeof(value) == TYPE_DICTIONARY:
		var out := {}
		for key in value:
			out[key] = _ints(value[key])
		return out
	if typeof(value) == TYPE_ARRAY:
		return value.map(_ints)
	return int(value) if typeof(value) == TYPE_FLOAT and value == floorf(value) else value


func _read(path: String) -> Dictionary:
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	assert(typeof(parsed) == TYPE_DICTIONARY, "%s is not a results file" % path)
	return parsed


func _same(actual: Variant, expected: Variant, what: String) -> void:
	if typeof(actual) != typeof(expected) or actual != expected:
		failed = true
		print("DIFFERS %s: recorded %s, replayed %s" % [what, var_to_str(expected), var_to_str(actual)])
