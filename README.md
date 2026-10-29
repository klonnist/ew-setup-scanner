# EW Dalga-3 Tarayıcı

OKX'te 24 saatlik hacme göre **ilk 50 kripto parayı** (stablecoin, tokenize hisse ve altın hariç) tarar
ve **Elliott Wave dalga 3 girişi** setup'larını listeler. Tarayıcıda çalışır; sunucu ve API anahtarı gerekmez.
Zaman dilimleri: 1m, 5m, 15m, 4H, 1D. 1m ve 5m'de sayım gürültülüdür ve dar stopta komisyon R'nin büyük kısmını yer.

## Setup tanımı

Son üç ZigZag dönüş noktası 0-1-2 olarak alınır (long: dip-tepe-dip, short: tersi). 0 noktası, aradaki tepe 1'i geçmiyor ve önceki dip daha aşağıdaysa geriye taşınabilir (Ayarlar → Dalga 1 başlangıcı; varsayılan 1 iç dalgalanma). Setup sayılması için:

| Koşul | Varsayılan |
|---|---|
| Dalga 2 **ABC** (zigzag veya flat) olmalı; iç yapı daha küçük dereceli ZigZag ile bulunur ve kural motorunda geçerli çıkmalı | zorunlu |
| Dalga 2'nin süresi dalga 1'den **uzun** olmalı (mum sayısı) | süre(2)/süre(1) > 1,0 |
| Dalga 2, dalga 1'i şu bantta geri almalı | %38,2 – %88,6 |
| 0-1-2 itki kuralları (seçilen kural setinde) ihlal edilmemeli | Kurs (Rules.docx) |
| Dalga 1 yeterince büyük olmalı | ≥ 3 × ATR |

Seviyeler: **tetik** = B dalgasının kırılımı (veya dalga 1 ucu, hangisi yakınsa), **stop** = dalga 2 ucu − 0,25 × ATR,
**geçersizlik** = 0 noktası, **hedefler** = dalga 2 ucu + {1; 1,618; 2,618} × dalga 1 (log ölçek).
Durumlar: *Hazırlanıyor* (tetik bekleniyor), *Tetiklendi*, *Kaçtı* (hedef 1'e ulaştı), *Geçersiz* (dalga 2 ucu kırıldı).

## Giriş tipleri

Araç çubuğundaki **Giriş tipi** ile seçilir; "İkisi birden" seçilince kartta iki plan ayrı R:R ile görünür.

- **B kırılımı (onaylı):** yukarıdaki seviyeler; dalga 2 tamamlandıktan sonra.
- **Limit bölge (erken):** giriş bölgesi = C = 1,272 × A (B'den ölçülür) ile dalga 2 = %61,8 geri çekilme arası
  (TradingView Fibonacci araçlarıyla aynı, doğrusal ölçek). Dalga 2 **sürerken** de (0-1-A-B onaylı, C oluşuyor) listelenir.
  - Giriş: kademeli (yarısı yakın, yarısı uzak kenar), yakın kenar veya uzak kenar.
  - Stop: dalga 1'in başı (0 noktası) veya dalga 2 = %88,6 — kullanıcı seçer; ATR tamponu iki tipte ortaktır.
  - Bölge gücü kenarların yakınlığına göre (≤ 1 ATR güçlü, ≤ 2,5 ATR orta); bölgeye düşen diğer seviyeler
    (C = 1A / 1,382A / 1,618A, %50 / %78,6 / %88,6) "çakışma" olarak sayılır.
  - Süre koşulu: limit emir ancak süre(2) > süre(1) olduktan sonra aktif sayılır (Ayarlar'dan kapatılabilir).
  - **★ Mükemmel:** iki kenar arası ≤ 0,5 ATR ise tek çakışma seviyesi; listede en üstte, "Sadece mükemmel" ile süzülebilir.
  - **Ön pay:** limit emir seviyenin 0,2 ATR önüne konur (fiyat seviyeye birkaç tik kala dönse de dolsun; 0 = tam seviye).
  - **Seviyeye yaklaştı:** fiyat emre 0,5 ATR'den yakınsa kart işaretlenir; otomatik yenilemede bildirim gelir.

Tüm eşikler sayfadaki **Ayarlar** bölmesinden değiştirilebilir; ayarlar konu başlıklarına ayrılmıştır (Genel, Dalga-3, Üçgen, ABCDE, Diagonal) ve seçili modun başlığı açık gelir. Ağ gerektirmeyen ayarlar önbellekteki mumlarla anında yeniden hesaplanır.

## ★ Takip listem

Kartlardaki ☆ ile bir setup takibe alınır: o anki giriş / stop / hedefler dondurulur. **★ Takip listem** sekmesinde her plan
kayıttan sonraki mumlarla değerlendirilir (backtest ile aynı dolum kuralları): Bekliyor → Girildi → Stop oldu / Hedef görüldü,
ayrıca Girişe gelmedi / Bozuldu / Süre doldu; açık pozisyonda anlık R. Her taramada ve otomatik yenilemede güncellenir;
durum değişince bildirim gelir. Not eklenebilir. Kayıt, kartın sağ üstündeki **✕** ya da ayrıntı başlığındaki
**Takipten çıkar** ile silinir; **Kapananları sil** açık planı kalmamış tüm kayıtları tek seferde temizler.

Liste **bu tarayıcıda** saklanır (sunucuya gitmez; başka bilgisayar / telefon kendi listesini tutar).
Taşımak için **Dışa aktar** → diğer cihazda **İçe aktar**.

## Üçgen kırılımı modu

Araç çubuğunda **Mod → Üçgen kırılımı**. Son 600 mumda (üçgenler aylarca sürebilir) ZigZag dönüş noktalarından:

- **Yükselen üçgen:** en az 2 tepe aynı seviyede (en yüksek tepeye ≤ 0,5 ATR), dipler en düşük dipten çıkan yükselen
  destek çizgisinin üstünde (en az 2 dokunuş) → yukarı kırılım. **Alçalan üçgen** aynası → aşağı kırılım.
- **Bağlam:** üçgenden önceki hareket (kalıp yüksekliğinin en az 2 katı) — "düşüş sonrası" / "yükseliş sonrası".
- **Durum:** oluşuyor · kırılıma yakın · kırıldı (kapanış düz kenarı 0,1 ATR geçti) · bozuldu (eğik kenar kırıldı).
- **Plan:** giriş kırılım kapanışı, stop son dibin (tepenin) 0,25 ATR ötesi; hedefler ölçülü hareket (1× yükseklik) ve
  önceki hareketin %38,2 / %50 / %61,8 / %78,6 / %100 seviyeleri (kırılım tersine ise geri çekilme, aynı yöndeyse izdüşüm).
- **Backtest → Mod: Üçgen kırılımı:** her kırılımın stop görülmeden önce ulaştığı en uç nokta kaydedilir;
  "Nereye kadar gitti?" tablosu Fib seviyelerine ve ölçülü hareket katlarına ulaşma oranlarını tip ve bağlama göre verir.

## Running üçgen (ABCDE) modu

Araç çubuğunda **Mod → Running üçgen (ABCDE)**. Dalga 3'ten sonra (dalga 4 yerinde) oluşan daralan / running üçgen,
son 600 mumda ZigZag'in art arda 6 dönüş noktası olarak aranır: 0 = üçgenin başlangıcı, ardından A-B-C-D-E (short için ayna).

- **Önceki hareket (dalga 3):** 0'a gelen hareketin alt derecede 5 dalgalı itki olup olmadığına kural motoruyla bakılır;
  bulunursa grafikte (1)-(2)-(3)-(4) olarak çizilir ve 0 dalga 3'ün sonu sayılır. Ayarlardan zorunlu ya da tercih (puan) seçilir.
  Hareketin başı 600 mumluk pencerenin sınırındaysa itki eksik görülebilir.
- **Kurallar:** C, A'nın sonunu geçemez · D, B'nin sonunu geçemez · E, C'nin sonunu geçemez.
  Tek istisna B: başlangıcı (0) geçebilir (**running**; geçmezse **daralan**).
- **Her bacak 3'lü:** A, B, C, D, E alt derecede ABC (zigzag / flat, kural motorunda geçerli) olmalı. Ayarlardan "tercih" yapılırsa
  elemez, puanı düşürür. Bacak iç yapısı doğrusal ölçekte kontrol edilir.
- **Bacak oranı:** her bacak bir öncekinin ≈ 0,618'i beklenir; aşmalar olabildiği için eleme değil, puan.
- **Planlar** (Ayarlar → ABCDE: giriş):
  - **E limiti (kural):** E = D − 0,618 × (D − C) seviyesinde limit emir; E bu seviyeyi aşabilir. Fiyat limite gelmeden D'yi geçerse iptal.
  - **E onayı:** ZigZag E'yi onayladığı (fiyat E'den k × ATR döndüğü) mumun kapanışından giriş.
  - Stop: C'nin 0,25 ATR ötesi. Hedefler: başlangıç 0 (running'de B), thrust (E + en geniş bacak), önceki hareket × 1,236 / 1,618 (log).
- Kartta ★ ile takibe alınır; takip grafiğinde 0-A-B-C-D-E ve A–C / B–D çizgileri görünür.
- **Backtest → Mod: Running üçgen:** iki plan ayrı raporlanır; "ABCDE: nereye kadar gitti?" tablosu girişten sonra
  stop görülmeden hangi hedeflere ulaşıldığını plan, tip (running / daralan) ve yöne göre verir.

## Diagonal modu (dalga 4 → 5 / ending / leading)

Araç çubuğunda **Mod → Diagonal**. Diagonal (kama), seçilen kural setinde (Kurs / Frost & Prechter / Neely) diagonal olarak
geçerli olmalı: dalga 4 dalga 1 bölgesine girer, daralan tipte 1>3>5 ve 2>4 (genişleyende tersi), 1–3 ve 2–4 çizgileri kama
oluşturur. Kurs kuralları en katısıdır; daha fazla aday için kural setini değiştir. **Ayarlar → Diagonal: türü** ile seçilir:

- **Dalga 4 → 5 (varsayılan):** diagonal'in 4. dalgasında giriş, 5. dalgayı alma. 0-1-2-3 oluşmuş, 4 oluşuyor (ya da yeni bitmiş).
  - Dalga 4 bölgesi: 0→3'ün %38,2–50'si (daralan) / %50–61,8'i (genişleyen), dalga 1 bölgesine kırpılır (örtüşme şartı).
  - **Dalga 4 limiti:** bölgenin yakın kenarında (Ayarlar'dan orta / uzak kenar) limit emir. **4 onayı:** ZigZag 4'ü onaylayınca kapanıştan giriş.
  - Stop: 4'ün geçersizlik seviyesinin ötesi — daralanda 4 dalga 2'den kısa olmalı (3 − dalga 2 boyu), genişleyende 2'nin ucu.
  - Hedef: **3'ün ucu** (kural gereği 5, 3'ü geçmeli). Limit dolmadan 3 aşılırsa kaçtı sayılır.
  - 4 dalga 1 bölgesine girmeden itkiden ayırt etmek için: dalga 2 dalga 1'in en az %50'sini geri almalı, genişleyende
    dalga 3 ≤ 1,618 × dalga 1, 0–2 ve 1–3 çizgileri kama oluşturmalı (Ayarlar'dan değiştirilebilir).
- **Ending dönüşü:** 5. / C dalgası bittikten sonra. Kapanış 2–4 çizgisini (0,1 ATR tamponla) kırınca diagonal'in **tersine** giriş.
  Stop 5'in ötesi; hedefler 4 → 2 → 0 (başlangıç).
- **Leading:** 1. / A dalgası olarak bittikten sonra dalga 2 için 0→5'in %61,8'inde limit, stop 0'ın ötesi;
  hedefler 5'in ucu, dalga 3 = 1 × ve 1,618 × dalga 1.
- Backtest'te türler ayrı raporlanır; "Diagonal: nereye kadar gitti?" tablosu hedeflere ulaşma oranlarını verir.

## SMT etiketi (yalnızca dalga-3 limit bölge long)

Dalga 2 sürerken (C oluşuyor) limit bölge LONG kurulumunda: C, A dibini süpürdü mü, aynı anda referans grafik
(BTC; BTC için ETH) de kendi dibini süpürdü mü? Önce sayım, sonra SMT: referans grafik yalnızca onaydır.

- **SMT ✓:** C, A dibini süpürdü, referans süpüremedi (stop avı → dönüş onayı).
- **SMT yok:** ikisi birlikte süpürdü.
- **Ters SMT:** referans süpürdü, coin süpürmedi.
- **Süpürme yok:** ikisi de A dibinin üstünde kaldı.

Neden yalnızca burada: 1 yıllık 4H backtestte (ilk 20 coin) limit bölge long'unda SMT ✓ olanlar +53R (151 işlem, PF 1,68)
getirdi ve yılın iki yarısında da kârlıydı. Short tarafında SMT ✓ en kötü gruptu (−35R); B kırılımı, ABCDE ve diagonalde
tutarlı bir fark çıkmadı. Bu yüzden etiket diğer kurulumlarda gösterilmez.

Referans grafikte uç noktanın ±N mumuna bakılır (ayar: SMT penceresi). Backtest'te yalnızca kalıbın görüldüğü
mumun kapanışına kadarki referans mumları kullanılır.

SMT **yalnızca etikettir**: kalıp, giriş, stop, hedef ve sıralama değişmez. "Sadece SMT'li limit bölge long'ları" ayarı
(varsayılan kapalı) açılırsa SMT'siz limit bölge long'ları gösterilmez ve backtest'te bunlara emir verilmez; diğer kurulumlar
etkilenmez. Backtest raporunda SMT filtresi ve "SMT" ile "Plan tipi × SMT" kırılımları vardır.

## Ders kitabı şekli (dalga-3, isteğe bağlı)

Her dalga-3 kurulumu dört şarta göre puanlanır (kartta 📐 x/4, ayrıntıda oranlar ve eksik şartlar):

1. **Net dalga 1:** verim (net kapanış farkı ÷ ardışık kapanış farklarının toplamı) ≥ 0,35 ve hız (dalga 1 boyu × ATR ÷
   mum sayısı) ≥ 0,3.
2. **Orantılı ABC:** a = dalga 1'in %30–60'ı, b = a'nın %45–90'ı, c = a'nın 1–1,4 katı (oluşurken bölge çakışma seviyesi);
   her bacak ≥ 1 ATR.
3. **★ çakışma:** %61,8 ile C = 1,272A neredeyse aynı seviye.
4. **Süre dengesi:** süre(2) / süre(1) ≤ 2,5.

"Sadece ders kitabı şekli" (varsayılan kapalı) açılırsa en az 3/4 (varsayılan; 4/4'ler dahil) ya da yalnızca 4/4 uyanlar gösterilir ve backtest'te yalnızca
onlara emir verilir. Backtest raporunda "Ders kitabı şablonu", "Şablonda eksik şart", "Dalga 1 verimi" ve "Dalga 1 hızı"
kırılımları vardır.

## Hedef seti ve kademeli çıkış (dalga-3)

"Hedef seti" ayarı: **Klasik** (C'den 1 · 1,618 · 2,618 × dalga 1) ya da **Kitabi** (dalga 1 tepesinin −0,236 uzantısı,
sonra C'den 1,272 · 1,618 · 2,618 × dalga 1). Backtest sonuçlarında "Çıkış hedefi" grubundaki **Kademeli (eşit)**
düğmesi pozisyonu hedeflere eşit böler (stop sabit); R, her hedefte tam çıkışın R ortalamasıdır.

## Çelişen sayım uyarısı

Modlar birbirinden bağımsız sayar; aynı yükseliş bir modda dalga 1, diğerinde dalga 4 olabilir. Tarama sırasında
her coin için diğer modlar da arka planda çalıştırılır (yön ayarı ve SMT filtresi uygulanmadan). Başka bir modda
**açık** bir kurulum ters yönü gösteriyorsa kartta ve ayrıntıda **⚠ Çelişen sayım · Diagonal SHORT** gibi bir chip
çıkar. Aynı modun başka derecesindeki zıt kurulum da sayılır (ör. dalga-3'te 4,5×ATR long, 2×ATR short); yalnızca
üçgen modunda kendi zıt kırılım yönü (simetrik üçgen) sayılmaz. Yalnızca etikettir: algılama,
sıralama, filtreler ve backtest değişmez.

## Backtest

[`backtest.html`](https://klonnist.github.io/ew-setup-scanner/backtest.html): zaman dilimi (1m / 5m / 15m / 4H / 1D) ve tarih aralığı seçilir (1m en fazla 14 gün, 5m en fazla 60 gün);
OKX geçmiş mumlarıyla her mum kapanışında canlı tarayıcının göreceği setup'lar bulunur ve emirler sonraki mumlarda simüle edilir
(gelecek veri kullanılmaz). Hesap Web Worker'larda yapılır.

- B kırılımı: tetik seviyesinde stop emir (setup tetiklenmiş görüldüyse o mumun kapanışından); dalga 2 uzarsa iptal.
- Limit bölge: yalnızca dalga 2 **sürerken** görülen setup'lar için limit emir; B kırılırsa veya hedef 1 görülürse iptal.
- Aynı mumda stop ve hedef → stop; dolum mumunda hedef sayılmaz; komisyon R'den düşülür.
- Rapor: işlem sayısı, kazanma oranı, ortalama / toplam R, kâr faktörü, maks. düşüş, kümülatif R grafiği ve
  plan tipi, yön, bölge gücü, çakışma, dalga 2 tipi, derece, coin kırılımları.
- Çalışmalar tarayıcıda (localStorage, ~3,5 MB sınır, tipik çalışma 10–100 KB) saklanır; JSON olarak dışa/içe aktarılabilir.
- **Para simülasyonu paneli** "Tarama ayarları"nın hemen altındadır. Üstündeki düğmelerle süzülür: **Tür** (modun alt türleri: Diagonal için Dalga 4 → 5 / Dalga 4 limiti / 4 onayı / Ending / Leading, ABCDE için E limiti / E onayı, Dalga-3 için B kırılımı / Limit bölge, Üçgen için Yükselen / Alçalan), **Yön** (Long / Short), **Çıkış hedefi** ve **Coin**. Rapor, R özeti ve işlem listesi de aynı seçimle hesaplanır.
- **Çıkış hedefi:** backtest her işlem için planın bütün hedeflerinde ayrı çıkışı da kaydeder (aynı giriş ve stop). Sonuçta
  "Hedef 1 / Hedef 2 / …" seçilince bütün rapor ve para simülasyonu o hedefte çıkılmış gibi yeniden hesaplanır; kazançları
  karşılaştırmak için backtest'i yeniden çalıştırmak gerekmez. Bu özellik bu sürümden sonra çalıştırılan backtestlerde vardır.
- **Para simülasyonu** (backtest yeniden çalışmadan, kayıtlı işlemlerle):
  - *Her işleme sabit tutar*: her sinyale aynı teminat (ör. 25 $); aynı anda gereken teminat ve sermaye yeterli mi gösterilir.
  - *Tek pozisyon, bakiyenin tamamı*: bileşik; pozisyon açıkken gelen sinyaller atlanır.
  - *Sermayeyi N parçaya böl*: parçalar doluyken gelen sinyal atlanır.
  - Kaldıraç ve izole marjin tasfiyesi: tasfiye fiyatı = giriş × (1 ∓ 1/kaldıraç ± bakım teminatı); işlem içi en kötü fiyat
    (backtest'in kaydettiği MAE) bu seviyeye ulaşırsa teminatın tamamı gider. Eski kayıtlarda yalnızca stop mesafesine bakılır.
  - Çıktılar: net $, kârlı/zararlı, tasfiye, ortalama kazanç/kayıp, en büyük düşüş, en düşük bakiye, bakiye eğrisi, aylık ve coin tablosu.
  - Aynı mumda birden çok sinyal varsa puanı yüksek olan önce alınır (çıkış zamanına bakılmaz). Funding ve kayma dahil değil.
- **İşlem grafiği:** işlem listesinde 📈 düğmesine basınca, işlemin açıldığı mumda backtest'in gördüğü kalıp aynı ayarlarla yeniden bulunur ve tarama ekranındaki grafikle çizilir; gerçekleşen giriş ve çıkış işaretlenir, sonrasındaki mumlar fiyatın ne yaptığını gösterir.
- **İşlemleri CSV indir:** süzülmüş işlemler, para simülasyonu sütunlarıyla (noktalı virgül, Excel'de açılır).

## Kural motoru

`src/ew/` klasörü [ew-chart-reader](https://github.com/klonnist/ew-chart-reader) projesinin `engine` ve `rules`
klasörlerinin değiştirilmemiş kopyasıdır (Rules.docx / Guidelines.docx, Frost & Prechter, Neely kural setleri).

## Geliştirme

```bash
npm test          # node --test tests/*.test.js
npm run serve     # http://localhost:8765
```

**Yatırım tavsiyesi değildir.** Otomatik dalga sayımı hatalı olabilir; grafiği kendin kontrol et.
