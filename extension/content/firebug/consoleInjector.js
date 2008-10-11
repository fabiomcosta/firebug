/* See license.txt for terms of usage */

//
FBL.ns(function() { with (FBL) {
// ************************************************************************************************
// Constants

const Cc = Components.classes;
const Ci = Components.interfaces;
const versionChecker = CCSV("@mozilla.org/xpcom/version-comparator;1", Ci.nsIVersionComparator);
const appInfo = CCSV("@mozilla.org/xre/app-info;1", Ci.nsIXULAppInfo);

top.Firebug.Console.injector = {

        isAttached: function(win)  // win needs to be a XPCSafeJSObjectWrapper
        {
            return (win._getFirebugConsoleElement ? true : false);
        },
        
        attachIfNeeded: function(context, win)
        {
            if (this.isAttached(win))
                return true;
            
            this.attachConsoleInjector(context, win);
            this.addConsoleListener(context, win);
        
            return this.isAttached(win);
        },
        
        attachConsoleInjector: function(context, win)
        {
            var consoleInjection = this.getConsoleInjectionScript();  // Do it all here.
           
            if (FBTrace.DBG_CONSOLE)
                FBTrace.sysout("attachConsoleInjector evaluating in "+win.location, consoleInjection);

            Firebug.CommandLine.evaluateInSandbox(consoleInjection, context, null, win);

            if (FBTrace.DBG_CONSOLE)
                FBTrace.sysout("attachConsoleInjector evaluation completed\n");
        },

        getConsoleInjectionScript: function() {
            if (!this.consoleInjectionScript)
            {
                var ff3 = versionChecker.compare(appInfo.version, "3.0*") >= 0;

                // There is a "console" getter defined for FF3.
                var script = "";
                if (ff3)
                {
                    script += "window.__defineGetter__('console', function() {\n";
                    script += " return window.loadFirebugConsole(); })\n\n";
                }

                script += "window.loadFirebugConsole = function() {\n";
                script += "window._firebug =  new _FirebugConsole();";
                // If not ff3 initialize "console" property.
                if (!ff3)
                    script += " window.console = window._firebug;\n";

                script += " return window._firebug };\n";
                
                var theFirebugConsoleScript = getResource("chrome://firebug/content/consoleInjected.js");
                script += theFirebugConsoleScript;
                
                if (!ff3)
                    script += " window.loadFirebugConsole();\n";
                
                this.consoleInjectionScript = script;
            }
            return this.consoleInjectionScript;
        },

    forceConsoleCompilationInPage: function(context, win)
    {
        if (!win)
        {
            if (FBTrace.DBG_CONSOLE)                                           /*@explore*/
                FBTrace.dumpStack("no win in forceConsoleCompilationInPage!");                 /*@explore*/
            return;
        }
        
        var consoleForcer = "window.loadFirebugConsole();";
        
        if (context.stopped)
            Firebug.Console.injector.evaluateConsoleScript(context);  // todo evaluate consoleForcer on stack
        else
            Firebug.CommandLine.evaluateInSandbox(consoleForcer, context, null, win);
    },

    evaluateConsoleScript: function(context)
    {
        var scriptSource = this.getConsoleInjectionScript(); // TODO XXXjjb this should be getConsoleInjectionScript
        Firebug.Debugger.evaluate(scriptSource, context);
    },

    addConsoleListener: function(context, win)
    {
        if (!context.consoleHandler)  // then we have not been this way before
            context.consoleHandler = [];  
        else
        {   // we've been this way, maybe already done?
            for (var i=0; i<context.consoleHandler.length; i++)
            {
                if (context.consoleHandler[i].window == win)
                    return true;
            }   
        }
        
        // We need the element to attach our event listener.
        var element = Firebug.Console.getFirebugConsoleElement(context, win);
        element.setAttribute("FirebugVersion", Firebug.version); // Initialize Firebug version.
        
        var handler = new FirebugConsoleHandler(context, win);
        // When raised on our injected element, callback to Firebug and append to console
        element.addEventListener('firebugAppendConsole', bind(handler.handleEvent, handler) , true); // capturing
        context.consoleHandler.push({window:win, handler:handler});

        if (FBTrace.DBG_CONSOLE)
            FBTrace.sysout("consoleInjector addConsoleListener attached handler to _firebugConsole in : "+win.location+"\n");
        return true;
    }
}

function FirebugConsoleHandler(context, win)
{
    this.handleEvent = function(event)
    {
        if (FBTrace.DBG_CONSOLE)
            FBTrace.dumpProperties("FirebugConsoleHandler "+event.target.getAttribute("methodName")+", event", event);
        if (!Firebug.CommandLine.CommandHandler.handle(event, this, win))
        {
            if (FBTrace.DBG_CONSOLE)
                FBTrace.dumpProperties("FirebugConsoleHandler", this);

            var methodName = event.target.getAttribute("methodName");
            Firebug.Console.log($STRF("console.MethodNotSupported", [methodName]));
        }
    };

    this.firebug = Firebug.version;

    this.init = function()
    {
        var consoleElement = win.document.getElementById('_firebugConsole');
        consoleElement.setAttribute("FirebugVersion", Firebug.version);
    };

    this.log = function()
    {
        logFormatted(arguments, "log");
    };

    this.debug = function()
    {
        logFormatted(arguments, "debug", true);
    };

    this.info = function()
    {
        logFormatted(arguments, "info", true);
    };

    this.warn = function()
    {
        logFormatted(arguments, "warn", true);
    };

    this.error = function()
    {
        Firebug.Errors.increaseCount(context);
        logFormatted(arguments, "error", true);
    };

    this.assert = function(x)
    {
        if (!x)
        {
            var rest = [];
            for (var i = 1; i < arguments.length; i++)
                rest.push(arguments[i]);
            logAssert(rest);
        }
    };

    this.dir = function(o)
    {
        Firebug.Console.log(o, context, "dir", Firebug.DOMPanel.DirTable);
    };

    this.dirxml = function(o)
    {
        if (o instanceof Window)
            o = o.document.documentElement;
        else if (o instanceof Document)
            o = o.documentElement;

        Firebug.Console.log(o, context, "dirxml", Firebug.HTMLPanel.SoloElement);
    };

    this.trace = function()
    {
        var trace = getJSDUserStack();
        Firebug.Console.log(trace, context, "stackTrace");
    };

    this.group = function()
    {
        var sourceLink = getStackLink();
        Firebug.Console.openGroup(arguments, null, "group", null, false, sourceLink);
    };

    this.groupEnd = function()
    {
        Firebug.Console.closeGroup(context);
    };

    this.groupCollapsed = function()
    {
        var sourceLink = getStackLink();
        // noThrottle true is probably ok, openGroups will likely be short strings.
        var row = Firebug.Console.openGroup(arguments, null, "group", null, true, sourceLink);
        removeClass(row, "opened");
    };

    this.profile = function(title)
    {
        Firebug.Profiler.startProfiling(context, title);
    };

    this.profileEnd = function()
    {
        Firebug.Profiler.stopProfiling(context);
    };

    this.count = function(key)
    {
        var frameId = FBL.getStackFrameId();
        if (frameId)
        {
            if (!context.frameCounters)
                context.frameCounters = {};

            if (key != undefined)
                frameId += key;

            var frameCounter = context.frameCounters[frameId];
            if (!frameCounter)
            {
                var logRow = logFormatted(["0"], null, true, true);

                frameCounter = {logRow: logRow, count: 1};
                context.frameCounters[frameId] = frameCounter;
            }
            else
                ++frameCounter.count;

            var label = key == undefined
                ? frameCounter.count
                : key + " " + frameCounter.count;

            frameCounter.logRow.firstChild.firstChild.nodeValue = label;
        }
    };

    this.clear = function()
    {
        Firebug.Console.clear(context);
    };

    this.time = function(name, reset)
    {
        if (!name)
            return;

        var time = new Date().getTime();

        if (!this.timeCounters)
            this.timeCounters = {};

        if (!reset && this.timeCounters[name])
            return;

        this.timeCounters[name] = time;
    };

    this.timeEnd = function(name)
    {
        var time = new Date().getTime();

        if (!this.timeCounters)
            return;

        var timeCounter = this.timeCounters[name];
        if (timeCounter)
        {
            var diff = time - timeCounter;
            var label = name + ": " + diff + "ms";

            this.info(label);

            delete this.timeCounters[name];
        }
        return diff;
    };

    // These functions are over-ridden by commandLine
    this.evaluated = function(result, context)
    {
        Firebug.Console.log(result, context);
    };
    this.evaluateError = function(result, context)
    {
        Firebug.Console.error(result, context);
    };

/*
    this.addTab = function(url, title, parentPanel)
    {
        context.chrome.addTab(context, url, title, parentPanel);
    };

    this.removeTab = function(url)
    {
        context.chrome.removeTab(context, url);
    };
*/

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

    function logFormatted(args, className, linkToSource, noThrottle)
    {
        var sourceLink = linkToSource ? getStackLink() : null;
        return Firebug.Console.logFormatted(args, context, className, noThrottle, sourceLink);
    }

    function logAssert(args)
    {
        Firebug.Errors.increaseCount(context);

        if (!args || !args.length || args.length == 0)
            var msg = [FBL.$STR("Assertion")];
        else
            var msg = args[0];

        var sourceName = win.location;
        var lineNumber = 0;
        var trace = getJSDUserStack();
        if (trace && trace.frames && trace.frames[0])
        {
            var frame = trace.frames[0];
            sourceName = normalizeURL(frame.script.fileName);
            lineNumber = frame.line;
        }

        var errorObject = new FBL.ErrorMessage(msg, sourceName,
                        lineNumber, "", "assert", context, trace);

        var row = Firebug.Console.log(errorObject, context, "errorMessage", null, true); // noThrottle
        row.scrollIntoView();
    }

    function getComponentsStackDump()
    {
        // Starting with our stack, walk back to the user-level code
        var frame = Components.stack;
        var userURL = win.location.href.toString();
        
        if (FBTrace.DBG_CONSOLE)
            FBTrace.sysout("consoleInjector.getComponentsStackDump initial stack for userURL "+userURL, frame);

        // Drop frames until we get into user code.
        while (frame && FBL.isSystemURL(frame.filename) )
            frame = frame.caller;
 
        if (FBTrace.DBG_CONSOLE)
            FBTrace.sysout("consoleInjector.getComponentsStackDump final stack for userURL "+userURL, frame);

        return frame;
    }

    function getStackLink()
    {
        return FBL.getFrameSourceLink(getComponentsStackDump());
    }

    function getJSDUserStack()
    {
        var trace = FBL.getCurrentStackTrace(context);

        var frames = trace ? trace.frames : null;
        if (frames && (frames.length > 0) )
        {
            var bottom = frames.length - 1;
            for (var i = 0; i < frames.length; i++)
                if (frames[bottom - i].href.indexOf("chrome:") == 0) break;

            trace.frames = trace.frames.slice(bottom - i + 1);
            return trace;
        }
        else
            return "Firebug failed to get stack trace with any frames";
    }
}

}});