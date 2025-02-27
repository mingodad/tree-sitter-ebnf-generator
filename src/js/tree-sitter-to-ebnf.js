#!/usr/bin/env node

if(!String.replaceAll)
{
	function escapeRegExp(string) {
		return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
	}
	String.prototype.replaceAll = function (find, replace) {
		return this.replace(new RegExp(escapeRegExp(find), 'g'), replace);
	};
}

console.assert(process.argv.length > 1, 'Usage: specify filename')
const grammar_js_fname = process.argv[2];
const acorn = require('acorn')
const walk = require('acorn-walk')
const fs = require('fs');
function print() { console.log.apply(this, arguments) }
function checkSingleCharEscaped(str) {
	switch(str) {
		case "\0": return "'\\0'";
		case "\b": return "'\\b'";
		case "\f": return "'\\f'";
		case "\n": return "'\\n'";
		case "\r": return "'\\r'";
		case "\t": return "'\\t'";
		case "\v": return "'\\v'";
		case "\\": return "'\\\\'";
		case "'": return "\"'\"";
		case "\"": return "'\"'";
		default:
			if(str.indexOf("'") >= 0) return '"' + str + '"';
			else return '\'' + str + '\'';
	}
}
function maybe_add_quotes(v) {
  return (typeof v !== 'object' && typeof v === 'string') ? checkSingleCharEscaped(v) : (v.value ? v.value : v.toString())
}
function _prec_impl(prefix, num, value) {
  prefix = prefix + (num ? num : '')
  if (typeof value !== 'object') {
    value = maybe_add_quotes(value)
  } else {
    value = value.value ? value.value : value.toString()
  }
  var is_seq = value.charAt(0) == '('
  return { value: prefix + (is_seq ? value : "(" + value + ")") }
}
function _prec(num, value) {
  return _prec_impl("", num, value);
}
function _token(value) {
  return _prec_impl("@", null, value);
}
var prec = {
  right: function() {
    if (arguments.length == 1) {
      return _prec_impl(">", undefined, arguments[0])
    } else {
      return _prec_impl(">", arguments[0], arguments[1])
    }
  },
  left: function() {
    if (arguments.length == 1) {
      return _prec_impl("<", undefined, arguments[0])
    } else {
      return _prec_impl("<", arguments[0], arguments[1])
    }
  },
  dynamic: function() {
    if (arguments.length == 1) {
      return _prec_impl("~", undefined, arguments[0])
    } else {
      return _prec_impl("~", arguments[0], arguments[1])
    }
  }
}
var token = {
  immediate: function(rule) {
    return _prec_impl("!", undefined, rule)
  }
}
function field(name, rule) {
  return { value: '(' + maybe_add_quotes(rule) + ": " + name + ')' }
}
function choice() {
  var result = ""
  for (i in arguments) {
    if (result.length > 0) result = result + " | "
    //if (result.length > 0) result = result + "\n\t| "
    var arg = arguments[i]
    result = result + maybe_add_quotes(arg)
  }
  return { value: '(' + result + ')' }
}
function optional(arg) {
  return { value: maybe_add_quotes(arg) + "?" }
}
function repeat(arg) {
  return { value: maybe_add_quotes(arg) + "*" }
}
function repeat1(arg) {
  return { value: maybe_add_quotes(arg) + "+" }
}
function alias(l, r) {
  return { value: '(' + maybe_add_quotes(l) + " -> " + maybe_add_quotes(r) + ')' }
}
function seq() {
  var result = ""
  for (i in arguments) {
    if (result.length > 1) result = result + " "
    var arg = arguments[i]
    result = result + maybe_add_quotes(arg)
  }
  //print(arguments);
  result = arguments.length > 1 || (!arguments[1] || arguments[1].content(" ")) ? '(' + result + ')' : result
  return { value: result }
}
function expandRhs(rhs, debug) {
  if (rhs instanceof Array) {
    var result = '{'
    for (const k in rhs) {
      var r = rhs[k]
      result = result + " " + (typeof r == 'object' && r.value ? r.value : r instanceof Array ? expandRhs(r) : maybe_add_quotes(r))
    }
    return result + (result.length > 1 ? ' }' : '}')
  } else if (typeof rhs === 'object') {
    return rhs.value ? rhs.value : rhs.toString();
  } else {
    return maybe_add_quotes(rhs)
  }
}
function cleanup(rhs) {
  return rhs.charAt(0) == '(' && rhs.charAt(rhs.length -1) == ')' ? rhs.substring(1, rhs.length -1) : rhs;
}
var $ = {}
function grammar(parts) {
  var rules = parts.rules
  for (const key in rules) {
    $[key] = { value: key }
  }
  for (const key in parts) {
    switch(key) {
      case 'name':
      case 'rules': break;
      default:
        print(key, " ::= ", cleanup(expandRhs(parts[key]($), true)))
        //print(key, " ::=\n\t", cleanup(expandRhs(parts[key]($), true)), "\n")
        print("")
    }
  }
  print("rules:")
  for (const key in rules) {
    print(" ", key, " ::= ", cleanup(expandRhs(rules[key]($))))
    //print(" ", key, " ::=\n\t", cleanup(expandRhs(rules[key]($))), "\n")
  }
}
fs.readFile(grammar_js_fname, 'utf-8', function (err, data) {
  if (err) throw err
  var parsed = acorn.parse(data, {ecmaVersion: 2020, locations: true})
  var constants = []
  var grammarImpl
  var functions = ""
  var rest = []
  var constString = ""
  walk.simple(parsed, {
    Program(p) {
      for (index in p.body) {
        var node = p.body[index]
        if (node.type === 'VariableDeclaration' && node.kind === 'const') {
          var decl = node.declarations[0]
	  			var name = decl.id.name
          for (i in decl.init.properties) {
						var prop = decl.init.properties[i]
            constants.push({ 'name': (name + '.' + prop.key.name), 'value': prop.value.value})
          }
          constString = constString + data.substring(node.start, node.end) + "\n"
        } else if (node.type === 'ExpressionStatement') {
          var left, name, prop;
          try {
            left = node.expression.left
            name = left.object.name
            prop = left.property.name
          } catch (error) {
            console.log(node);
            console.log("\nerror: " + grammar_js_fname + ":" + node.loc.start.line + ":" + node.loc.start.column);
            throw(error);
          }
          if (name != 'module' || prop != 'exports') {
            print('Only module.exports is allowed (got ' + name + '.' + prop + ')')
            throw ""
          }
          var right = node.expression.right
          grammarImpl = data.substring(node.start, node.end)
            .replaceAll("prec(", "_prec(")
            .replaceAll("token(", "_token(")
        } else if (node.type === 'FunctionDeclaration') {
          functions = functions + data.substring(node.start, node.end)
            .replaceAll("prec(", "_prec(")
            .replaceAll("token(", "_token(") + "\n"
        } else {
          print("unexpected type '" + node.type + "' for node:", node)
          throw ""
        }
      }
    }
  })
  walk.full(parsed, node => {
    if (node.type == 'MemberExpression') {
      if (node.object.name === '$') {
        var prop = node.property.name
        $[prop] = { value: prop }
      }
    }
  })
  /*
   * TODO add support for referencing constants in the generated
   * ebnf format instead of inlining them
   *for (i in constants) {
   *  print(constants[i].name, ":=", constants[i].value)
   *}
   */
  const all_transformed = constString + functions + grammarImpl;
  try {
    eval(all_transformed)
  } catch(error) {
     console.log("\n**==>>**\n", all_transformed, "\n**==<<**\n");
     throw(error);
  }
});
