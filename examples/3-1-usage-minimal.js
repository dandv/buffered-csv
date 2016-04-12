const csv = require('buffered-csv');
var file = new csv.File({
    path: 'celebrities.csv'
});
file.add({
    Name: 'Albert Einstein',
    Expertise: 'Relativity'
});
file.add({
    Name: 'Galileo Galilei',
    Expertise: 'Gravity',
    Birthyear: 1564
});
file.add({
    Name: 'Shen Kuo',
    Expertise: 'Astronomy',
});
file.complete();
