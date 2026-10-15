# EW Dalga-3 Tarayıcı

OKX'te 24 saatlik hacme göre **ilk 50 kripto parayı** (stablecoin, tokenize hisse ve altın hariç) tarar
ve **Elliott Wave dalga 3 girişi** setup'larını listeler. Tarayıcıda çalışır; sunucu ve API anahtarı gerekmez.

## Setup tanımı

Son üç ZigZag dönüş noktası 0-1-2 olarak alınır (long: dip-tepe-dip, short: tersi). Setup sayılması için:

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

Tüm eşikler sayfadaki **Ayarlar** bölmesinden değiştirilebilir. Ağ gerektirmeyen ayarlar önbellekteki mumlarla anında yeniden hesaplanır.

## Kural motoru

`src/ew/` klasörü [ew-chart-reader](https://github.com/klonnist/ew-chart-reader) projesinin `engine` ve `rules`
klasörlerinin değiştirilmemiş kopyasıdır (Rules.docx / Guidelines.docx, Frost & Prechter, Neely kural setleri).

## Geliştirme

```bash
npm test          # node --test tests/*.test.js
npm run serve     # http://localhost:8765
```

**Yatırım tavsiyesi değildir.** Otomatik dalga sayımı hatalı olabilir; grafiği kendin kontrol et.
