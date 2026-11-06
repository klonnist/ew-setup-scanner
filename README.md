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

Stop ve hedeflerin yanındaki yüzdeler (kart, ayrıntı, grafik, takip listesi) girişten ölçülür: kazanç +, zarar −, short'ta da
aynı. Kaldıraçsız ve komisyonsuzdur. Giriş; dolmamış emirde emir seviyesi (kademelide ortalama), dolmuşta gerçekleşen ortalamadır.

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
  - **B oluşurken de göster** (liste üstünde kutu, Ayarlar'da da; varsayılan kapalı; yalnızca limit bölge): A onaylıysa B bitmeden
    kurulum listelenir, kartta "B oluşuyor" yazar. B oynadıkça C seviyesi ve emir de oynar; canlı mum B'yi geçerse B onun ucu olur.
    Onaylı B varsa sonuç değişmez. B oluşan sayım "Çelişen sayım" etiketine girmez; SMT ölçülemez, "Sadece SMT'li" açıkken gizlenir.
    Takibe alınan plan dondurulur: fiyat o B'yi geçince iptal olur.

**Veri** (araç çubuğunda, Ayarlar'da ve backtest sayfasında): **OKX spot** (varsayılan) ya da **OKX vadeli**. Seçim yalnızca Dalga-3'e aittir,
Fib kesişiminin kendi seçimi vardır. Fonlama maliyeti backtest'e dahil değildir. SMT referansı backtest'te BTC / ETH spot, taramada liste içindeyse vadeli grafiğidir.

İki seçeneğin etkisi (limit bölge long, ikinci hedef, min. R:R 2, aynı 20 coin ve dönem; işlem · toplam R · PF). Backtest'te oluşan B
yükseldikçe yeni emir verilir, fiyat eski B'yi geçince eski emir iptal olur; yani emrin elle güncellendiği varsayılır. Şablon satırları
şablonsuz koşudan süzüldü (15m spot'ta doğrudan koşuya göre 1 işlem fark).

| | Spot, kom. %0,1 | Vadeli, kom. %0,1 | Vadeli, kom. %0,05 |
|---|---|---|---|
| 4H, şablon, B bekle | 46 · −7,2R · 0,74 | 63 · −7,0R · 0,81 | 63 · −6,1R · 0,83 |
| 4H, şablon, B oluşurken | 46 · −7,2R · 0,74 | 63 · −7,1R · 0,81 | 63 · −6,1R · 0,83 |
| 4H, şablonsuz, B bekle | 410 · +75,3R · 1,35 | 415 · +56,6R · 1,25 | 415 · +64,2R · 1,30 |
| 4H, şablonsuz, B oluşurken | 418 · +71,8R · 1,32 | 422 · +52,3R · 1,23 | 422 · +60,2R · 1,27 |
| 15m, şablon, B bekle | 193 · −14,1R · 0,88 | 212 · −5,4R · 0,96 | 212 · +10,8R · 1,09 |
| 15m, şablon, B oluşurken | 192 · −18,3R · 0,85 | 213 · −7,4R · 0,94 | 213 · +9,3R · 1,08 |
| 15m, şablonsuz, B bekle | 1700 · −151,8R · 0,88 | 1739 · −171,4R · 0,86 | 1739 · +6,3R · 1,01 |
| 15m, şablonsuz, B oluşurken | 1742 · −189,8R · 0,85 | 1777 · −197,2R · 0,85 | 1777 · −11,3R · 0,99 |

B oluşurken giriş hiçbir satırı iyileştirmedi: 4H şablonlu satırlarda neredeyse aynı, diğerlerinde 3–38R daha kötü. Aynı komisyonla vadeli
spot'tan belirgin iyi değil (4H şablonsuzda daha kötü); 15m'deki fark çoğunlukla komisyondan gelir. 15m'de sonucun işaretini komisyon belirliyor.

Tüm eşikler sayfadaki **Ayarlar** bölmesinden değiştirilebilir; ayarlar konu başlıklarına ayrılmıştır (Genel, Dalga-3, Üçgen, ABCDE, Diagonal, Fib kesişimi) ve seçili modun başlığı açık gelir. Ağ gerektirmeyen ayarlar önbellekteki mumlarla anında yeniden hesaplanır.

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
  - **Dalga 4 limiti (varsayılan: Fibonacci çakışmaları, kademeli):** yarısı üst çakışmada (0→3 %38,2 ≈ 2→3 %50), yarısı
    alt çakışmada (0→3 %50 ≈ 2→3 %61,8); genişleyende bir kademe derin (%50/%61,8 ve %61,8/%78,6). Seviyeler dalga 1 bölgesine
    kırpılır (örtüşme şartı). İki Fibonacci seviyesi 0,5 ATR'den yakınsa çakışma "sıkı" sayılır (kartta "Fib çakışması x/2").
    Ayarlar'dan eski tek seviye (0→3'ün %38,2–50'si / %50–61,8'i bölgesinin yakın / orta / uzak kenarı) seçilebilir.
  - **4 onayı:** ZigZag 4'ü onaylayınca kapanıştan giriş ("4 tamam · 5 başlıyor").
  - Stop: 4'ün geçersizlik seviyesinin ötesi — daralanda 4 dalga 2'den kısa olmalı (3 − dalga 2 boyu), genişleyende 2'nin ucu.
  - Hedefler: **H1 = 3'ün ucu**, **H2 (ana) = 0→3 ve 2→3 −0,236 uzantılarının ortası**; daralanda dalga 5, dalga 3'ten kısa
    kalacak şekilde sınırlanır. Limit dolmadan 3 aşılırsa kaçtı sayılır.
  - **Alt dalgalar:** her bacak (doğru sayımla) 3'lü (a-b-c) ya da 5'li (i–v) sayılır; hepsi 3 → **3-3-3-3-3**, 1-3 beş ve 2-4
    üç → **5-3-5-3-5**. Grafikte bacakların içinde a-b / i–iv etiketleri ve Fibonacci çizgileri gösterilir. "Sadece kitabi
    diagonal" ayarı alt yapısı belirsiz ya da sıkı çakışması olmayanları gizler.
  - Öne çıkarma ve bildirim: **4 bölgesine yaklaşıyor**, **4 bölgesinde · x/2 doldu**, **4 tamam · 5 başlıyor** aşamaları listenin
    üstünde; her geçişte tarayıcı bildirimi. Genel → Yön ayarı diagonal modunda da uygulanır.
  - 4 dalga 1 bölgesine girmeden itkiden ayırt etmek için: dalga 2 dalga 1'in en az %50'sini geri almalı, genişleyende
    dalga 3 ≤ 1,618 × dalga 1, 0–2 ve 1–3 çizgileri kama oluşturmalı (Ayarlar'dan değiştirilebilir).
- **Ending dönüşü:** 5. / C dalgası bittikten sonra. Kapanış 2–4 çizgisini (0,1 ATR tamponla) kırınca diagonal'in **tersine** giriş.
  Stop 5'in ötesi; hedefler 4 → 2 → 0 (başlangıç).
- **Leading:** 1. / A dalgası olarak bittikten sonra dalga 2 için 0→5'in %61,8'inde limit, stop 0'ın ötesi;
  hedefler 5'in ucu, dalga 3 = 1 × ve 1,618 × dalga 1.
- Backtest'te türler ayrı raporlanır; "Diagonal: nereye kadar gitti?" tablosu hedeflere ulaşma oranlarını verir.

## Fib kesişimi modu

Araç çubuğunda **Mod → Fib kesişimi (0,618×1,272)**. Fikir [mugiatama34/crypto_technical_analysis](https://github.com/mugiatama34/crypto_technical_analysis)
sitesinden (MIT); kod bu projenin yapısına göre yazıldı.

Bir itkiden (0→1) sonra düzeltme: itkinin **%61,8 geri çekilmesi** ile **C = B − 1,272 × A** aynı yere (≤ 0,5 ATR) düşüyorsa
ortasına limit emir. Yön itkinin yönü. Formül dalga-3'teki ★ Mükemmel ile aynıdır; fark etrafındaki şartlardadır:

- Elliott kuralı ve süre şartı yok. Son dört dönüş noktasına bakılır (ZigZag 2 / 3 / 4 × ATR): itki ≥ 3 ATR, A itkiye ters,
  B, A'nın %38,2–100'ünü geri almış, bölge A'nın ötesinde ve itkinin başından önce.
- Stop itkinin %88,6'sı + tampon (Ayarlar'da itkinin başı da seçilebilir). H1 = itki ucu, H2 = itki ucu + 0,272 × itki.
- Ayarlar → Oranlar: sadece 0,618 × 1,272 (varsayılan) ya da tüm çiftler (0,5 / 0,618 / 0,786 × 1,272 / 1,382 / 1,618).
- **Veri:** araç çubuğunda (Ayarlar'da da) **OKX spot** (varsayılan) ya da **OKX vadeli**. Vadelide coin listesi USDT vadeli
  sözleşmelerin hacmine göre sıralanır, mumlar `-USDT-SWAP` paritesinden gelir, backtest de aynı veriyi kullanır. Seçim
  bu moda aittir: Dalga-3'ün kendi Veri seçimi vardır, Üçgen, ABCDE ve Diagonal spot mumlarla taranır. Vadeli işlemin fonlama maliyeti
  backtest'e dahil değildir.
- **B oluşurken de göster** (liste üstünde kutu, Ayarlar'da da; varsayılan kapalı): normalde B onaylanmadan kurulum çıkmaz,
  çünkü B oynadıkça C seviyesi ve giriş de oynar. Açılınca son üç onaylı nokta + oluşan uçla kurulum listelenir, kartta
  "B oluşuyor" yazar. Canlı mum B'yi geçerse kurulum, mum kapanıp yeni B belli olana kadar gizlenir. Kaynak sitede bu aşama
  hep görünür.
- **Min. R:R** (Ayarlar → Fib kesişimi, varsayılan 2, 0 = filtre yok): yalnızca bu modun filtresidir, Dalga-3 ayarından bağımsızdır.
- Kaynak site coin başına tek kurulum seçer ve geçmiş dolumlara bakmaz; bu yüzden aynı ayarlarla da listeler birebir aynı olmaz.
- Giriş hep limit; Genel → Yön ayarı uygulanır; SMT etiketi yoktur. Diğer modların sonuçları değişmez.

Backtest (20 coin, ikinci hedefte çıkış; 4H 1 yıl komisyon %0,1, 15m 3 ay vadeli komisyon %0,035). R ve PF:

| | 4H hepsi | 4H long | 4H short | 15m hepsi | 15m long | 15m short |
|---|---|---|---|---|---|---|
| Fib 0,618×1,272, stop %88,6 | 47 · −6,8R · 0,82 | 18 · −4,6R · 0,69 | 29 · −2,2R · 0,90 | 216 · +15,5R · 1,10 | 115 · +20,6R · 1,26 | 101 · −5,1R · 0,93 |
| Fib 0,618×1,272, stop itki başı | 19 · −4,3R · 0,70 | 8 · −1,9R · 0,68 | 11 · −2,4R · 0,72 | 109 · +15,2R · 1,22 | 58 · +16,3R · 1,50 | 51 · −1,1R · 0,97 |
| Fib tüm çiftler, stop %88,6 | 103 · +18,9R · 1,23 | 48 · −16,2R · 0,64 | 55 · +35,1R · 1,92 | 643 · −15,3R · 0,97 | 327 · +56,7R · 1,20 | 316 · −72,0R · 0,76 |
| Fib tüm çiftler, stop itki başı | 75 · +21,7R · 1,42 | 38 · −8,8R · 0,72 | 37 · +30,6R · 2,59 | 518 · +2,4R · 1,01 | 258 · +52,7R · 1,28 | 260 · −50,4R · 0,77 |
| Dalga-3 ★ mükemmel | 205 · −7,7R · 0,94 | 105 · +2,3R · 1,04 | 100 · −10,1R · 0,85 | 835 · +74,6R · 1,14 | 417 · +82,4R · 1,32 | 418 · −7,7R · 0,97 |
| Dalga-3 limit (filtresiz) | 745 · +22,1R · 1,05 | 410 · +75,3R · 1,35 | 335 · −53,3R · 0,76 | 3475 · +329,5R · 1,15 | 1700 · +184,1R · 1,18 | 1775 · +145,4R · 1,13 |

İki zaman diliminde tutarlı bir üstünlük yok: 0,618×1,272 4H'de negatif, tüm çiftlerde yönler ters (4H'de short, 15m'de long kazanıyor)
ve işlem sayıları az. Bu mod bir "bakılacak yer" olarak düşünülmeli; aynı yönde tutarlı sonuç dalga-3 limit long'da.

Aynı coinler, aynı dönem ve aynı komisyonla OKX vadeli mumları (fonlama hariç):

| | 4H hepsi | 4H long | 4H short | 15m hepsi | 15m long | 15m short |
|---|---|---|---|---|---|---|
| Fib 0,618×1,272, stop %88,6 | 42 · +2,7R · 1,09 | 14 · −0,3R · 0,97 | 28 · +3,0R · 1,15 | 189 · +22,2R · 1,17 | 103 · +9,1R · 1,12 | 86 · +13,1R · 1,23 |
| Fib 0,618×1,272, stop itki başı | 19 · −1,0R · 0,93 | 6 · +0,2R · 1,06 | 13 · −1,2R · 0,87 | 93 · +29,8R · 1,60 | 54 · +25,9R · 1,95 | 39 · +3,9R · 1,18 |
| Fib tüm çiftler, stop %88,6 | 108 · +15,3R · 1,17 | 51 · −19,3R · 0,60 | 57 · +34,6R · 1,85 | 589 · +15,1R · 1,03 | 303 · +38,4R · 1,15 | 286 · −23,3R · 0,91 |
| Fib tüm çiftler, stop itki başı | 81 · +18,3R · 1,32 | 40 · −5,7R · 0,83 | 41 · +24,0R · 1,97 | 486 · +26,3R · 1,07 | 253 · +54,0R · 1,29 | 233 · −27,7R · 0,85 |

Vadeli biraz daha iyi görünüyor, ama aynı kuralın 4H'de −6,8R'den +2,7R'ye dönmesi 40 küsur işlemde sonucun ne kadar
oynak olduğunu da gösterir; belirgin bir üstünlük sayılmaz.

İki seçeneğin etkisi (stop %88,6, ikinci hedef, iki yön, aynı coin ve dönem). Backtest'te oluşan B yükseldikçe yeni emir
verilir, fiyat eski B'yi geçince eski emir iptal olur; yani emrin elle güncellendiği varsayılır.

| | B bekle, R:R 2 (varsayılan) | B bekle, R:R 0 | B oluşurken, R:R 2 | B oluşurken, R:R 0 |
|---|---|---|---|---|
| 4H spot, 0,618×1,272 | 47 · −6,8R · 0,82 | 47 · −6,8R · 0,82 | 53 · −13,2R · 0,70 | 53 · −13,2R · 0,70 |
| 4H vadeli, 0,618×1,272 | 42 · +2,7R · 1,09 | 42 · +2,7R · 1,09 | 50 · −2,0R · 0,95 | 50 · −2,0R · 0,95 |
| 4H spot, tüm çiftler | 103 · +18,9R · 1,23 | 126 · +15,1R · 1,15 | 111 · +19,2R · 1,21 | 136 · +15,2R · 1,14 |
| 4H vadeli, tüm çiftler | 108 · +15,3R · 1,17 | 127 · +8,0R · 1,08 | 119 · +15,7R · 1,16 | 141 · +10,9R · 1,10 |
| 15m spot, 0,618×1,272 | 216 · +15,5R · 1,10 | 216 · +15,5R · 1,10 | 258 · +4,2R · 1,02 | 258 · +4,2R · 1,02 |
| 15m vadeli, 0,618×1,272 | 189 · +22,2R · 1,17 | 189 · +22,2R · 1,17 | 232 · +17,2R · 1,10 | 232 · +17,2R · 1,10 |
| 15m spot, tüm çiftler | 643 · −15,3R · 0,97 | 739 · −18,6R · 0,97 | 723 · −61,4R · 0,91 | 827 · −60,2R · 0,92 |
| 15m vadeli, tüm çiftler | 589 · +15,1R · 1,03 | 673 · +6,8R · 1,01 | 681 · +1,8R · 1,00 | 776 · −2,9R · 1,00 |

İki seçenek listeyi kaynak siteye yaklaştırır ama sonucu iyileştirmez: R:R 2 ile B oluşurken giriş 8 satırın 6'sında düşürdü,
2'sinde (4H tüm çiftler) neredeyse aynı kaldı. R:R filtresini kapatmak 4 satırda düşürdü, 0,618×1,272 satırlarında değiştirmedi.

## Senaryo okları

Liste üstündeki **Senaryo okları** kutusu (varsayılan açık) grafiğe aktif plandan iki kesikli yol çizer: yeşil **ana yol**
(fiyat → giriş → H1 → H2) ve kırmızı **alternatif yol** (fiyat → giriş → stop → iptal). İşleme girildiyse giriş adımı atlanır,
fiyatın geride bıraktığı hedefler çizilmez, aktif plan yoksa ok çıkmaz. Tüm modlarda ve takip listesinde çalışır; backtest
grafiğinde çizilmez. Yalnızca çizimdir: algılama, sıralama ve backtest değişmez. **Tahmin değildir**, planın çizimidir; zaman
ekseni temsilîdir. Kaynak sitedeki "likidite süpürme" yolu yoktur, çünkü burada likidite dedektörü yok.

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
2. **Orantılı ABC:** a = dalga 1'in %30–60'ı, b = a'nın %50–78,6'sı, c = a'nın 1–1,4 katı (oluşurken bölge çakışma
   seviyesi); her bacak ≥ 1 ATR. A–B ilişkisi 1–2 ilişkisi gibi kurulur: A da dalga 1 gibi net itki olmalı (aynı verim/hız
   eşikleri); değilse eksik şart "A testere" yazılır.
3. **★ çakışma:** %61,8 ile C = 1,272A neredeyse aynı seviye.
4. **Süre dengesi:** süre(2) / süre(1) ≤ 2,5.

"Sadece ders kitabı şekli" (varsayılan kapalı) açılırsa en az 3/4 (varsayılan; 4/4'ler dahil) ya da yalnızca 4/4 uyanlar gösterilir ve backtest'te yalnızca
onlara emir verilir. Backtest raporunda "Ders kitabı şablonu", "Şablonda eksik şart", "Dalga 1 verimi" ve "Dalga 1 hızı"
kırılımları vardır.

## Yapı şablonu (dalga-3, isteğe bağlı)

Liste üstündeki **🧩 Sadece şablon** kutusu (Ayarlar → Dalga yapısı'nda da var) yalnızca **dalga 1'i içte 5'li itki** olan
kurulumları gösterir: daha küçük ZigZag derecelerinde iç pivotlar bulunur (fazlası en küçük salınımlar birleştirilerek 4'e
indirilir) ve 0-i-ii-iii-iv-v itki kurallarına uyar (ii 0'ı geçmez, iii en kısa değil, iv i'ye girmez). Grafikte i–iv küçük
etiketlerle gösterilir.

Diğer şablon şartları zorunlu değil, kartta ("🧩 Şablon ✓ x/y") ve ayrıntıda bilgi olarak görünür: ii/iv değişimi, (a) ve (c)
içte 5'li ((c) yalnızca bittiyse ölçülür), dalga 2 ≈ %50–61,8, süre(2)/süre(1) 0,5–1,5. (a)'nın iç dalgaları kısa olduğu için
çoğu zaman aynı grafikte görülemez; zorunlu tutulunca neredeyse hiç kurulum kalmadı.

Kutu yalnızca filtredir: bölge, süre koşulu ve hedefler normal ayarlardan gelir. İstenirse "Hedef seti → Şablon"
(**dalga 1 tepesi · −0,236 uzantı · C'den 1 · 1,618 · 2,618 × dalga 1**) ayrıca seçilebilir.

Backtest (limit bölge long, ii ve iv en büyük iki düzeltme olan doğru sayımla): 4H 1 yılda dalga 1'i 5'li olanlar 48 işlem
−7,6R PF 0,73, diğerleri 367 işlem +81,0R PF 1,43. 15m 3 ayda 5'liler 205 işlem +28,5R PF 1,29, diğerleri PF 1,20. Yani bu
filtrenin 4H'de ölçülen bir üstünlüğü yok; eski sayımdaki "67 işlem PF 2,41" sonucu tekrar etmedi. Backtest raporunda
"Yapı şablonu" ve "Yapı şablonunda eksik" kırılımları vardır.

## Yapı kırılımı (dalga-3, isteğe bağlı)

Sistem 0 noktasını seçili derecedeki son dönüş noktasından alır; bu, süren bir düşüşün ortasındaki bir dip olabilir.
Önceki trendin bitip bitmediği **yapı kırılımıyla** ölçülür: dalga 1, aynı derecede 0'dan önceki son tepeyi (short'ta
son dibi) geçti mi? Düşüş trendinde tepeler alçalır; son alçalan tepenin kırılması düşüşün bittiğini gösterir.

Kırılmadıysa kartta "⚠ Yapı kırılmadı" görünür. "Yapı kırılımı şart" (varsayılan kapalı) açılırsa bu kurulumlar
gösterilmez ve backtest'te emir verilmez. Backtest raporunda "Yapı kırılımı" ve "0 öncesi son bacak" kırılımları vardır.

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
