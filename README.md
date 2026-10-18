# EW Dalga-3 Tarayıcı

OKX'te 24 saatlik hacme göre **ilk 50 kripto parayı** (stablecoin, tokenize hisse ve altın hariç) tarar
ve **Elliott Wave dalga 3 girişi** setup'larını listeler. Tarayıcıda çalışır; sunucu ve API anahtarı gerekmez.

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

Tüm eşikler sayfadaki **Ayarlar** bölmesinden değiştirilebilir. Ağ gerektirmeyen ayarlar önbellekteki mumlarla anında yeniden hesaplanır.

## ★ Takip listem

Kartlardaki ☆ ile bir setup takibe alınır: o anki giriş / stop / hedefler dondurulur. **★ Takip listem** sekmesinde her plan
kayıttan sonraki mumlarla değerlendirilir (backtest ile aynı dolum kuralları): Bekliyor → Girildi → Stop oldu / Hedef görüldü,
ayrıca Girişe gelmedi / Bozuldu / Süre doldu; açık pozisyonda anlık R. Her taramada ve otomatik yenilemede güncellenir;
durum değişince bildirim gelir. Not eklenebilir.

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

## Backtest

[`backtest.html`](https://klonnist.github.io/ew-setup-scanner/backtest.html): zaman dilimi (15m / 4H / 1D) ve tarih aralığı seçilir;
OKX geçmiş mumlarıyla her mum kapanışında canlı tarayıcının göreceği setup'lar bulunur ve emirler sonraki mumlarda simüle edilir
(gelecek veri kullanılmaz). Hesap Web Worker'larda yapılır.

- B kırılımı: tetik seviyesinde stop emir (setup tetiklenmiş görüldüyse o mumun kapanışından); dalga 2 uzarsa iptal.
- Limit bölge: yalnızca dalga 2 **sürerken** görülen setup'lar için limit emir; B kırılırsa veya hedef 1 görülürse iptal.
- Aynı mumda stop ve hedef → stop; dolum mumunda hedef sayılmaz; komisyon R'den düşülür.
- Rapor: işlem sayısı, kazanma oranı, ortalama / toplam R, kâr faktörü, maks. düşüş, kümülatif R grafiği ve
  plan tipi, yön, bölge gücü, çakışma, dalga 2 tipi, derece, coin kırılımları.
- Çalışmalar tarayıcıda (localStorage, ~3,5 MB sınır, tipik çalışma 10–100 KB) saklanır; JSON olarak dışa/içe aktarılabilir.

## Kural motoru

`src/ew/` klasörü [ew-chart-reader](https://github.com/klonnist/ew-chart-reader) projesinin `engine` ve `rules`
klasörlerinin değiştirilmemiş kopyasıdır (Rules.docx / Guidelines.docx, Frost & Prechter, Neely kural setleri).

## Geliştirme

```bash
npm test          # node --test tests/*.test.js
npm run serve     # http://localhost:8765
```

**Yatırım tavsiyesi değildir.** Otomatik dalga sayımı hatalı olabilir; grafiği kendin kontrol et.
