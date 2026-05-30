function doGet(e)  { return handle(e.parameter); }
function doPost(e) { return handle(e.parameter); }

function handle(p) {
  try {
    const ss    = SpreadsheetApp.openById(SHEET_ID);
    let   sheet = ss.getSheetByName(TAB_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(TAB_NAME);
      sheet.appendRow(['תאריך', 'שם', 'טלפון', 'מייל', 'נושא', 'בעיות', 'שעה מועדפת', 'יום מועדף', 'הערות']);
      sheet.getRange(1, 1, 1, 9).setFontWeight('bold');
    }

    sheet.appendRow([
      new Date(),
      p.name     || '',
      p.phone    || '',
      p.email    || '',
      p.subject  || '',
      p.problems || '',
      p.time     || '',
      p.day      || '',
      p.notes    || ''
    ]);

    MailApp.sendEmail({
      to:      EMAIL,
      subject: '🔔 ליד חדש — ' + (p.name || 'לא ידוע'),
      body:    'פנייה חדשה מהדף!\n\n'
             + 'שם: '           + (p.name     || '')           + '\n'
             + 'טלפון: '        + (p.phone    || '')           + '\n'
             + 'מייל: '         + (p.email    || 'לא צוין')    + '\n'
             + 'נושא: '         + (p.subject  || 'לא נבחר')   + '\n'
             + 'בעיות: '        + (p.problems || 'לא נבחר')   + '\n'
             + 'שעה מועדפת: '   + (p.time     || 'לא צוין')   + '\n'
             + 'יום מועדף: '    + (p.day      || 'לא משנה')   + '\n'
             + 'הערות: '        + (p.notes    || 'אין')        + '\n'
             + 'זמן: '          + new Date().toLocaleString('he-IL')
    });

    return ContentService.createTextOutput('ok');

  } catch(err) {
    return ContentService.createTextOutput('ERROR: ' + err.toString());
  }
}
