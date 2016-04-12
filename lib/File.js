const EventEmitter	= require('events');
const util			= require('util');
const fs			= require('fs');
const _				= require('private-parts').createKey();

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// Class:		File
//
// Description:	An encapsulation of a CSV file that implements buffered writes.
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
var File = module.exports = function(options) {
	EventEmitter.call(this);
	_getOptions.call(this, options);
	_open.call(this);
}
util.inherits(File, EventEmitter);

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// Function:	_getOptions
//
// Description:	Retrieves options that are passed to the constructor and supplements them with default values.
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
var _getOptions = function(options) {

	var _getOne = function(name, defaultValue) {
		return (options === undefined || options[name] === undefined ) ? defaultValue : options[name];
	}

	this.encoding		= _getOne('encoding',		'utf8');
	this.delimeter		= _getOne('delimeter',		',');
	this.quote			= _getOne('quote',			'"');
	this.escape			= _getOne('escape',			'\\');
	this.nullValue		= _getOne('nullValue',		'NULL');
	this.eol			= _getOne('eol',			require('os').EOL);
	this.headers		= _getOne('headers',		true);
	this.overwrite		= _getOne('overwrite', 		true);
	this.fields			= _getOne('fields',			{});
	this.flushInterval	= _getOne('flushInterval',	0);
	this.flushLines		= _getOne('flushLines',		0);
	this.path			= _getOne('path');

	if(this.path === undefined)
		throw 'missing option: \'path\'.';
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// Function:	_open
//
// Description:	"Open" the csv file. We do not actually keep any files open on disk, but open sets up the in-memory structures to enable everything
//				to add data to the csv file.
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
var _open = function() {
	var _that = this;

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Setup internal data structures
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	_(this).lastPath		= null;		// We rember the path to the last file we saved to. If the path changes we must rewrite headers.
	_(this).buffer			= [];

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Start timer for interval based flushing
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	if(this.flushInterval > 0)
		_(this).timerFlushInterval = setInterval(function() {
			_that.flush();
		}, this.flushInterval);

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Track state. Untill complete() is called we consider the file 'open' which means add(), flush() and complete() can be called.
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	_(this).open = true;
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// Function:	_requireOpen
//
// Description:	Throws an exception if the output file is not currently open (functionally).
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
var _requireOpen = function() {
	if(!_(this).open)
		throw 'file_not_open';
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// Function:	_getPath
//
// Description:	Retrieves the current value for the path option, which is either the string literal or the return value for the callback.
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
var _getPath = function() {
	return (typeof this.path !== 'function') ? this.path : this.path();
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// Function:	_autodetectFields
//
// Description:	Under the condition that an object is passed as a parameter to add() then the object holds field names and values. Possibly there are
//				some field names that were not previously passed, in which case we'll add them to the end of the fieldlist. The result is that the
//				associated value get's added to the end of the line and future references to this field will have their values placed at the same
//				position in the csv line.
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
var _autodetectFields = function(data) {
	var _that = this;

	var names = Object.keys(data);
	names.forEach(function(name) {
		if(_that.fields[name] !== undefined)
			return;
		_that.fields[name] = {
			quoted: true
		}
	});
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// Function:	_buildLinedata
//
// Description:	This converts whatever is passed as data for a csv line (an array or an object) to an array that holds the values for a single csv
//				line sorted in the correct order.
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
var _buildLinedata = function(data) {
	if(!Array.isArray(data)) {
		_autodetectFields.call(this, data);
		var dataset = [];
		Object.keys(this.fields).forEach(function(name) {
			dataset.push(data[name]);
		});
		data = dataset;
	}
	return data;
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// Function:	_enquote
//
// Description:	Encloses a string in quotes.
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
var _enquote = function(value) {
	if(value.toString === undefined)
		throw 'not_a_string';
	return this.quote + value.toString().replace(this.quote, this.escape + this.quote) + this.quote;
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// Function:	_generateCsvHeaders
//
// Description:	Actually generate csv output for the first line of a file that holds the headers of each field.
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
var _generateCsvHeaders = function() {
	return Object.keys(this.fields).map(function(value) {
		return _enquote.call(this, value);
	}, this).join(this.delimeter) + this.eol
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// Function:	_generateCsvData
//
// Description:	Actually generate csv output for the lines that hold the actual values.
//
//				Buffer is an array of lines. Each line is an array of values. The order of the values in the line array match up with the order of
//				the fields. For each line array entry we lookup the corresponding field. If the value is undefined or null we return the nullValue.
//				Otherwise, we do or do not enquote the value, based on the field's settings.
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
var _generateCsvData = function() {
	var fieldIndices = Object.keys(this.fields);
	return _(this).buffer.map(function(lineData) {
		var line = lineData.map(function(value, index) {
			var field = this.fields[fieldIndices[index]]
			if((value === undefined) || (value === null))
				return this.nullValue;
			return field.quoted ? _enquote.call(this, value) : value;
		}, this);
		while(line.length < fieldIndices.length)
			line.push(this.nullValue);
		return line.join(this.delimeter) + this.eol;
	}, this).join('');
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// Function:	add
//
// Description:	Adds a line to the csv file. It is added to the buffer and if tresholds are met the buffer gets flushed.
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
File.prototype.add = function(data) {
	_requireOpen.call(this);

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Only accept arrays or key/value maps
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	if(typeof data !== 'object')
		throw 'invalid_data';

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Add the new data to our buffer
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	_(this).buffer.push(_buildLinedata.call(this, data));

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Decide wether to flush for flushLines
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	if((this.flushLines > 0) && (_(this).buffer.length > this.flushLines))
		this.flush();

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Decide wether to flush for all else
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	else if((this.flushLines == 0) && (this.flushInterval == 0))
		this.flush();
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// Function:	flush
//
// Description:	Write the contents of the buffer to file and clear the buffer.
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
File.prototype.flush = function() {
	_requireOpen.call(this);
	var _that = this;

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Nothing to flush
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	if(_(this).buffer.length == 0)
		return;

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Determine output file
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	var path = _getPath.call(this);

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Generate data output
	//
	// Headers are added only:
	//		- if the headers option is set to true
	//		- AND we will write to a file we have not yet written to before
	//		- AND (we overwrite the file or it does not exist)
	//
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	var csv = ((this.headers && (_(this).lastPath != path) && (this.overwrite || fs.existsSync(path))) ? _generateCsvHeaders.call(this) : '') + _generateCsvData.call(this);
	_(this).buffer = [];

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Actually save output
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	this.emit('data', path, csv);

	var saveFunction = fs[(this.overwrite && (_(this).lastPath != path)) ? 'writeFile' : 'appendFile'];
	saveFunction(path, csv, {
		encoding: this.encoding
	}, function(err) {
		if(err)
			_that.emit('error', err, path, csv);
	});

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Track last used path so we know if we:
	// a) need to write headers
	// b) need to append or overwrite
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	_(this).lastPath = path;
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// Function:	complete
//
// Description:	Flushes any remaining data in the buffer, clears all timers and "closes" the file for any further adding.
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
File.prototype.complete = function() {
	_requireOpen.call(this);

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Stop flush interval
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	if(_(this).timerFlushInterval !== null) {
		clearInterval(_(this).timerFlushInterval);
		_(this).timerFlushInterval = null;
	}

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Perform final flush
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	this.flush();

	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// add(), flush() and complete() may no longer be called from now on.
	/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	_(this).open = false;
}
