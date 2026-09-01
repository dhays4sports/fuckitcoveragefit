(() => {
  'use strict';
  const status = document.getElementById('calendarStatus');
  const eventRegion = document.getElementById('calendarEvent');
  const when = document.getElementById('calendarWhen');
  const google = document.getElementById('googleCalendar');
  const device = document.getElementById('deviceCalendar');
  const token = new URL(location.href).searchParams.get('token') || '';
  const stamp = value => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const googleUrl = event => {
    const query = new URLSearchParams({
      action: 'TEMPLATE',
      text: event.title,
      dates: `${stamp(event.start)}/${stamp(event.end)}`,
      details: `Dylan will call you at the scheduled time. Virginia Tam Insurance Agency, Inc. · ${event.agencyPhone}`,
      ctz: event.timeZone
    });
    return `https://calendar.google.com/calendar/render?${query}`;
  };
  if (!/^[A-Za-z0-9_-]{24,96}$/.test(token)) {
    status.textContent = 'This appointment link is unavailable.';
    return;
  }
  fetch(`/api/sms/callback/calendar?token=${encodeURIComponent(token)}`, { credentials: 'same-origin', cache: 'no-store' })
    .then(async response => ({ response, data: await response.json().catch(() => ({})) }))
    .then(({ response, data }) => {
      if (!response.ok || !data.ok) throw new Error('This appointment link is unavailable or has expired.');
      const event = data.event;
      status.textContent = 'Your callback is confirmed.';
      when.textContent = event.display;
      google.href = googleUrl(event);
      google.target = '_blank';
      google.rel = 'noopener noreferrer nofollow';
      device.href = `/api/sms/callback/calendar?token=${encodeURIComponent(token)}&format=ics`;
      eventRegion.hidden = false;
    })
    .catch(cause => { status.textContent = cause.message; });
})();
