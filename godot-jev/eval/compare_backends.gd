extends SceneTree
## Compares TypeSafe Jev and Open Jev on the recorded session's lines, asking
## every backend the same question in the same game state (see eval/compare.gd):
##   godot --headless --path . --script res://eval/compare_backends.gd -- --rounds 3
## Needs TYPESAFE_API_KEY and a running Open Jev server (OPENJEV_URL, default
## http://127.0.0.1:3002). Pin TYPESAFE_DEFAULT_MODEL for numbers you record.
## Each `--openjev name=url` adds another Open Jev server, for a second model:
##   ... -- --rounds 3 --openjev flash9b=http://127.0.0.1:3003
## Prints a table and a summary, and writes every row to eval/results-<time>.json.

const JevNode := preload("res://addons/jev/jev.gd")
const Parser := preload("res://demo/parser.gd")
const Compare := preload("res://eval/compare.gd")


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	var args := OS.get_cmdline_user_args()
	var at := args.find("--rounds")
	var rounds := int(args[at + 1]) if at >= 0 and at + 1 < args.size() else 1
	var backends := Compare.backends(args, JevNode.environment())
	if backends.is_empty():
		print("--openjev takes name=url, with a name other than typesafe or openjev, once per server")
		quit(2)
		return
	var names := backends.keys()
	var parsers := {}
	var configs := {}
	for name in names:
		var config: Dictionary = backends[name]
		if config.key_required and config.api_key.is_empty():
			print("%s needs TYPESAFE_API_KEY" % config.label)
			quit(2)
			return
		var decider := JevNode.new_decider(config)
		root.add_child(decider)
		parsers[name] = Parser.new(decider)
		configs[name] = {"label": config.label, "base_url": config.base_url, "model": config.model}

	# The first request pays for a TLS handshake or a cold model, not a turn.
	var warm := Compare.World.from_file(Compare.WORLD)
	for name in names:
		var out: Dictionary = await parsers[name].parse("look around", warm)
		if out.kind == "error":
			print("%s is not answering: %s" % [configs[name].label, out.reason])
			quit(2)
			return

	var rows: Array = await Compare.play(parsers, rounds)
	_print_rows(rows, names, configs)
	var summaries := {}
	for name in names:
		summaries[name] = Compare.summary(rows, name)
		configs[name].served = _served(rows, name)
	var agree := Compare.agreements(rows, names)
	_print_summary(summaries, configs, agree)
	var path := "res://eval/results-%s.json" % Time.get_datetime_string_from_system().replace(":", "")
	var file := FileAccess.open(path, FileAccess.WRITE)
	file.store_string(JSON.stringify({
		"when": Time.get_datetime_string_from_system(true), "rounds": rounds, "backends": configs,
		"thresholds": {"act": parsers[names[0]].act_confidence, "clarify": parsers[names[0]].clarify_confidence},
		"summary": summaries, "same_top_choice": agree, "rows": rows,
	}, "  "))
	file.close()
	print("wrote %s" % ProjectSettings.globalize_path(path))
	quit(0)


func _served(rows: Array, backend: String) -> String:
	for r in rows:
		if r.backend == backend and not str(r.model).is_empty():
			return r.model
	return ""


func _cell(r: Dictionary) -> String:
	var mark := "✓" if r.landed else "✗"
	var move: String = r.action if r.kind == "act" else ("/".join(r.options) if r.kind == "clarify" else "")
	return "%s %-7s %-18s %.2f %5d ms" % [mark, r.kind, move.left(18), r.confidence, r.ms]


func _print_rows(rows: Array, names: Array, configs: Dictionary) -> void:
	print("%-44s %-17s │ %s" % ["line", "means", " │ ".join(names.map(func(n): return "%-41s" % configs[n].label))])
	var by_turn := {}
	var order := []
	for r in rows:
		var key := "%d|%s" % [r.round, r.say]
		if not by_turn.has(key):
			by_turn[key] = {}
			order.append(key)
		by_turn[key][r.backend] = r
	for key in order:
		var turn: Dictionary = by_turn[key]
		var first: Dictionary = turn.values()[0]
		var means: String = first.means if not first.means.is_empty() else "(unknown)"
		print("%-44s %-17s │ %s" % [first.say.left(44), means, " │ ".join(names.map(func(n): return _cell(turn[n])))])


func _print_summary(summaries: Dictionary, configs: Dictionary, agree: Dictionary) -> void:
	print("")
	for name in summaries:
		var s: Dictionary = summaries[name]
		print("%-17s landed %d/%d  act %d  clarify %d  unknown %d  error %d  p50 %d ms  p95 %d ms  max %d ms" % [
			configs[name].label, s.landed, s.turns, s.act, s.clarify, s.unknown, s.error, s.p50_ms, s.p95_ms, s.max_ms])
		print("                  %s" % configs[name].served)
	for pair in agree:
		var who := Array(pair.split("|")).map(func(n): return configs[n].label)
		print("%s and %s: same top choice on %d of %d turns" % [who[0], who[1], agree[pair][0], agree[pair][1]])
