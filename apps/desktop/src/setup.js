// The desktop app's own setup page (till mode): what this PC is, finding the main PC, and the
// "can't reach the main PC" screen. Talks to the main process only through window.pakoSetup.
;(function () {
  const TEXT = {
    en: {
      chooseTitle: 'How will this PC be used?',
      chooseText: 'Choose once. A till can be pointed at another main PC later.',
      mainTitle: 'Main PC',
      mainText: 'Keeps all the data: accounting, stock and the POS. Tills on the shop network connect to it.',
      tillTitle: 'Till',
      tillText: 'Only the till and kitchen screens, working on the main PC’s data. Nothing is stored on this PC.',
      findTitle: 'Find the main PC',
      findText: 'On the main PC, turn on Settings → “Allow tills on this network”. It shows up here when it is on the same network.',
      searching: 'Looking on this network…',
      none: 'No main PC found. Type its address instead (Settings → Tills on this network shows it).',
      addressLabel: 'Main PC address',
      connect: 'Connect',
      back: 'Back',
      rescan: 'Search again',
      offlineTitle: 'Can’t reach the main PC',
      offlineText: 'This till works on the main PC’s data at {server}. Check that the main PC is on, PAKO is open on it, and both are on the same network.',
      retrying: 'Trying again every few seconds…',
      change: 'Use another main PC',
      retry: 'Try now',
      badAddress: 'That is not an address. Type it like 192.168.1.10',
      notFound: 'No PAKO main PC answered at {server}. Check the address, and that “Allow tills on this network” is on.',
    },
    sq: {
      chooseTitle: 'Si do të përdoret ky kompjuter?',
      chooseText: 'Zgjidhet një herë. Një arkë mund të lidhet më vonë me një kompjuter tjetër kryesor.',
      mainTitle: 'Kompjuteri kryesor',
      mainText: 'Mban të gjitha të dhënat: kontabilitetin, stokun dhe POS-in. Arkat në rrjetin e lokalit lidhen me të.',
      tillTitle: 'Arkë',
      tillText: 'Vetëm arka dhe ekranet e kuzhinës, me të dhënat e kompjuterit kryesor. Asgjë nuk ruhet në këtë kompjuter.',
      findTitle: 'Gjeni kompjuterin kryesor',
      findText: 'Në kompjuterin kryesor, aktivizoni Cilësimet → “Lejo arkat në këtë rrjet”. Shfaqet këtu kur është në të njëjtin rrjet.',
      searching: 'Duke kërkuar në këtë rrjet…',
      none: 'Nuk u gjet asnjë kompjuter kryesor. Shkruani adresën e tij (e shfaq Cilësimet → Arkat në këtë rrjet).',
      addressLabel: 'Adresa e kompjuterit kryesor',
      connect: 'Lidhu',
      back: 'Kthehu',
      rescan: 'Kërko përsëri',
      offlineTitle: 'Kompjuteri kryesor nuk arrihet',
      offlineText: 'Kjo arkë punon me të dhënat e kompjuterit kryesor në {server}. Kontrolloni që kompjuteri kryesor është ndezur, PAKO është i hapur dhe të dy janë në të njëjtin rrjet.',
      retrying: 'Provohet përsëri çdo disa sekonda…',
      change: 'Përdor një kompjuter tjetër kryesor',
      retry: 'Provo tani',
      badAddress: 'Kjo nuk është adresë. Shkruajeni si 192.168.1.10',
      notFound: 'Asnjë kompjuter kryesor PAKO nuk u përgjigj në {server}. Kontrolloni adresën dhe që “Lejo arkat në këtë rrjet” është aktiv.',
    },
  }
  const lang = (navigator.language || 'en').toLowerCase().startsWith('sq') ? 'sq' : 'en'
  const t = (key, values) => (TEXT[lang][key] || TEXT.en[key]).replace(/\{(\w+)\}/g, (_, k) => (values && values[k]) || '')
  const $ = (id) => document.getElementById(id)
  const setup = window.pakoSetup
  const params = new URLSearchParams(location.search)

  document.documentElement.lang = lang
  document.querySelectorAll('[data-t]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-t'))
  })

  function show(id) {
    for (const s of ['choose', 'till', 'offline']) $(s).hidden = s !== id
  }

  function tillError(message) {
    $('till-error').hidden = !message
    $('till-error').textContent = message || ''
  }

  async function connectTo(address) {
    tillError(null)
    $('connect').disabled = true
    try {
      const result = await setup.chooseTill(address)
      if (!result.ok) tillError(result.error === 'badAddress' ? t('badAddress') : t('notFound', { server: result.server || address }))
    } finally {
      $('connect').disabled = false
    }
  }

  async function scan() {
    $('searching').hidden = false
    $('none').hidden = true
    $('found').replaceChildren()
    const found = await setup.discover().catch(() => [])
    $('searching').hidden = true
    $('none').hidden = found.length > 0
    for (const server of found) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'choice found'
      const name = document.createElement('strong')
      name.textContent = server.machine || server.url
      const where = document.createElement('small')
      where.textContent = server.url
      button.append(name, where)
      button.addEventListener('click', () => connectTo(server.url))
      $('found').append(button)
    }
  }

  function openTill() {
    show('till')
    $('back').hidden = params.get('view') === 'till'
    void scan()
    $('address').focus()
  }

  $('pick-main').addEventListener('click', () => setup.chooseMain())
  $('pick-till').addEventListener('click', openTill)
  $('back').addEventListener('click', () => show('choose'))
  $('rescan').addEventListener('click', () => void scan())
  $('manual').addEventListener('submit', (e) => {
    e.preventDefault()
    const value = $('address').value.trim()
    if (value) void connectTo(value)
  })
  $('change').addEventListener('click', () => setup.changeServer())
  $('retry').addEventListener('click', () => setup.retryNow())

  const view = params.get('view')
  if (view === 'offline') {
    $('offline-text').textContent = t('offlineText', { server: params.get('server') || '' })
    show('offline')
  } else if (view === 'till') openTill()
  else show('choose')
})()
