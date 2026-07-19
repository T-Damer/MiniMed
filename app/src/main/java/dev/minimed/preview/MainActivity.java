package dev.minimed.preview;

import android.app.Activity;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public final class MainActivity extends Activity {
    private static final String DB_ASSET = "minimed-core.db";
    private static final int PAPER = Color.rgb(242, 233, 216);
    private static final int PAPER_DARK = Color.rgb(228, 212, 184);
    private static final int INK = Color.rgb(36, 33, 28);
    private static final int MUTED = Color.rgb(93, 87, 77);
    private static final int FOLDER = Color.rgb(167, 139, 85);
    private static final int ACCENT = Color.rgb(141, 59, 46);
    private static final int GREEN = Color.rgb(51, 93, 75);

    private SQLiteDatabase database;
    private EditText query;
    private TextView status;
    private LinearLayout results;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(PAPER_DARK);
        getWindow().setNavigationBarColor(PAPER_DARK);
        try {
            database = openDatabase();
            setContentView(buildScreen());
            search("Девочка 9 лет, боль началась около пупка, затем сместилась вправо вниз. "
                + "Однократно рвало, аппетита нет, больнее идти и кашлять. Диареи нет.");
        } catch (Exception error) {
            TextView fatal = text("Не удалось открыть встроенную базу.\n\n" + error, 16, ACCENT);
            fatal.setPadding(dp(22), dp(22), dp(22), dp(22));
            fatal.setBackgroundColor(PAPER);
            setContentView(fatal);
        }
    }

    @Override
    protected void onDestroy() {
        if (database != null) database.close();
        super.onDestroy();
    }

    private View buildScreen() {
        ScrollView page = new ScrollView(this);
        page.setFillViewport(true);
        page.setBackgroundColor(PAPER);

        LinearLayout root = column();
        root.setPadding(dp(18), dp(22), dp(18), dp(36));
        page.addView(root);

        TextView stamp = text("ЛОКАЛЬНАЯ КАРТОТЕКА · 0.3.0-alpha.3", 11, FOLDER);
        stamp.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        root.addView(stamp);

        TextView title = text("MiniMed", 36, INK);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setPadding(0, dp(4), 0, 0);
        root.addView(title);

        TextView subtitle = text(
            "Свободный клинический ввод и поиск по SQLite внутри APK",
            16,
            MUTED
        );
        subtitle.setPadding(0, dp(2), 0, dp(12));
        root.addView(subtitle);

        LinearLayout badges = row();
        badges.addView(chip("OFFLINE", GREEN));
        badges.addView(chip("EMBEDDED SQLITE", FOLDER));
        badges.addView(chip("NO INTERNET", MUTED));
        root.addView(badges);

        query = new EditText(this);
        query.setTextColor(INK);
        query.setHintTextColor(Color.rgb(130, 120, 105));
        query.setTextSize(17);
        query.setGravity(Gravity.TOP);
        query.setMinLines(5);
        query.setMaxLines(10);
        query.setPadding(dp(15), dp(14), dp(15), dp(14));
        query.setInputType(
            InputType.TYPE_CLASS_TEXT
                | InputType.TYPE_TEXT_FLAG_MULTI_LINE
                | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        );
        query.setHint("Опишите случай: возраст, симптомы, сроки, отрицания, анализы...");
        query.setBackground(panel(Color.rgb(250, 246, 237), FOLDER, 12));
        LinearLayout.LayoutParams queryParams = matchWrap();
        queryParams.topMargin = dp(16);
        root.addView(query, queryParams);

        LinearLayout actions = row();
        actions.setPadding(0, dp(10), 0, dp(4));
        Button search = button("Искать локально");
        search.setOnClickListener(view -> search(query.getText().toString()));
        actions.addView(search);
        Button clear = button("Очистить");
        clear.setOnClickListener(view -> search(""));
        LinearLayout.LayoutParams clearParams = wrapWrap();
        clearParams.leftMargin = dp(8);
        actions.addView(clear, clearParams);
        root.addView(actions);

        HorizontalScrollView examplesScroll = new HorizontalScrollView(this);
        examplesScroll.setHorizontalScrollBarEnabled(false);
        LinearLayout examples = row();
        examples.setPadding(0, dp(6), 0, dp(10));
        examples.addView(example(
            "Живот",
            "Ребёнок, боль около пупка перешла вправо вниз, рвота, больно ходить"
        ));
        examples.addView(example(
            "Дыхание",
            "Мальчик 5 лет, температура 39, кашель, часто дышит, сатурация 93%"
        ));
        examples.addView(example(
            "Сыпь",
            "Лихорадка, кашель, конъюнктивит и сыпь, которая началась с лица"
        ));
        examplesScroll.addView(examples);
        root.addView(examplesScroll);

        status = text("", 12, MUTED);
        status.setTypeface(Typeface.MONOSPACE);
        status.setPadding(0, dp(4), 0, dp(10));
        root.addView(status);

        results = column();
        root.addView(results);

        TextView disclaimer = text(
            "SYNTHETIC DEMO · NOT CLINICAL GUIDANCE\n"
                + "Карточки искусственные и предназначены только для проверки APK, "
                + "локальной базы и поискового конвейера.",
            12,
            ACCENT
        );
        disclaimer.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        disclaimer.setPadding(dp(12), dp(12), dp(12), dp(12));
        disclaimer.setBackground(panel(Color.rgb(248, 224, 211), ACCENT, 10));
        LinearLayout.LayoutParams disclaimerParams = matchWrap();
        disclaimerParams.topMargin = dp(12);
        root.addView(disclaimer, disclaimerParams);
        return page;
    }

    private void search(String raw) {
        if (!raw.equals(query.getText().toString())) {
            query.setText(raw);
            query.setSelection(raw.length());
        }
        hideKeyboard();

        List<Card> cards = loadCards();
        List<String> tokens = tokenize(expand(raw));
        for (Card card : cards) card.score = score(card, tokens);
        if (!tokens.isEmpty()) cards.removeIf(card -> card.score <= 0);
        cards.sort(Comparator
            .comparingInt((Card card) -> card.score).reversed()
            .thenComparing(Comparator.comparingInt((Card card) -> card.priority).reversed())
            .thenComparing(card -> card.title));

        results.removeAllViews();
        int shown = Math.min(cards.size(), 7);
        status.setText(String.format(
            Locale.ROOT,
            "INDEX: %d CARDS · MATCHES: %d · LOCAL TOKEN RANKING",
            countCards(),
            shown
        ));
        if (shown == 0) {
            TextView empty = text(
                "Совпадений нет. Добавьте возраст, локализацию, длительность или бытовой синоним.",
                16,
                MUTED
            );
            empty.setPadding(dp(14), dp(14), dp(14), dp(14));
            empty.setBackground(panel(Color.rgb(250, 246, 237), FOLDER, 10));
            results.addView(empty);
            return;
        }
        for (int i = 0; i < shown; i++) results.addView(resultCard(cards.get(i), i + 1));
    }

    private View resultCard(Card card, int rank) {
        LinearLayout folder = column();
        folder.setPadding(dp(15), dp(14), dp(15), dp(15));
        folder.setBackground(panel(Color.rgb(250, 246, 237), FOLDER, 12));

        TextView tab = text(
            String.format(Locale.ROOT, "ПАПКА %02d · SCORE %d", rank, card.score),
            11,
            FOLDER
        );
        tab.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        folder.addView(tab);

        TextView title = text(card.title, 22, INK);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setPadding(0, dp(4), 0, dp(2));
        folder.addView(title);

        TextView section = text(card.section, 13, ACCENT);
        section.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        section.setPadding(0, 0, 0, dp(8));
        folder.addView(section);

        TextView body = text(card.body, 16, MUTED);
        body.setLineSpacing(0, 1.12f);
        folder.addView(body);

        LinearLayout.LayoutParams params = matchWrap();
        params.bottomMargin = dp(11);
        folder.setLayoutParams(params);
        return folder;
    }

    private SQLiteDatabase openDatabase() throws Exception {
        File destination = new File(getFilesDir(), "minimed-core-0.3.0-alpha.3.db");
        if (!destination.exists()) {
            File temporary = new File(getFilesDir(), destination.getName() + ".tmp");
            try (InputStream input = getAssets().open(DB_ASSET);
                 FileOutputStream output = new FileOutputStream(temporary)) {
                byte[] buffer = new byte[16 * 1024];
                int read;
                while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
                output.getFD().sync();
            }
            if (!temporary.renameTo(destination)) {
                throw new IllegalStateException("Cannot install embedded database");
            }
        }
        SQLiteDatabase db = SQLiteDatabase.openDatabase(
            destination.getAbsolutePath(),
            null,
            SQLiteDatabase.OPEN_READONLY
        );
        try (Cursor cursor = db.rawQuery("PRAGMA quick_check", null)) {
            if (!cursor.moveToFirst() || !"ok".equals(cursor.getString(0))) {
                throw new IllegalStateException("Database integrity check failed");
            }
        }
        return db;
    }

    private List<Card> loadCards() {
        List<Card> cards = new ArrayList<>();
        try (Cursor cursor = database.rawQuery(
            "SELECT id, title, section, body, keywords, priority "
                + "FROM knowledge_cards ORDER BY priority DESC, title ASC",
            null
        )) {
            while (cursor.moveToNext()) {
                cards.add(new Card(
                    cursor.getString(0),
                    cursor.getString(1),
                    cursor.getString(2),
                    cursor.getString(3),
                    cursor.getString(4),
                    cursor.getInt(5)
                ));
            }
        }
        return cards;
    }

    private int countCards() {
        try (Cursor cursor = database.rawQuery("SELECT COUNT(*) FROM knowledge_cards", null)) {
            cursor.moveToFirst();
            return cursor.getInt(0);
        }
    }

    private int score(Card card, List<String> tokens) {
        if (tokens.isEmpty()) return card.priority;
        String title = normalize(card.title);
        String section = normalize(card.section);
        String body = normalize(card.body);
        String keywords = normalize(card.keywords);
        int score = 0;
        for (String token : tokens) {
            if (title.contains(token)) score += 12;
            if (section.contains(token)) score += 8;
            if (keywords.contains(token)) score += 6;
            if (body.contains(token)) score += 3;
        }
        return score;
    }

    private String expand(String raw) {
        String normalized = normalize(raw);
        Map<String, String> aliases = new HashMap<>();
        aliases.put("часто дышит", "тахипноэ одышка дыхание");
        aliases.put("температурит", "температура лихорадка");
        aliases.put("жар", "температура лихорадка");
        aliases.put("около пупка", "околопупочная живот аппендицит");
        aliases.put("справа внизу", "правая подвздошная аппендицит");
        aliases.put("вправо вниз", "правая подвздошная аппендицит");
        aliases.put("рвало", "рвота");
        aliases.put("больно мочиться", "дизурия мочевые пути");
        aliases.put("часто мочится", "мочевые пути дизурия");
        aliases.put("сыпь с лица", "сыпь лицо корь");
        aliases.put("не бледнеет", "геморрагическая сыпь менингококк");
        aliases.put("жидкий стул", "диарея гастроэнтерит");
        aliases.put("сухая кожа", "атопический дерматит");

        StringBuilder expanded = new StringBuilder(normalized);
        for (Map.Entry<String, String> alias : aliases.entrySet()) {
            if (normalized.contains(alias.getKey())) expanded.append(' ').append(alias.getValue());
        }
        return expanded.toString();
    }

    private List<String> tokenize(String value) {
        Set<String> stop = new LinkedHashSet<>(Arrays.asList(
            "и", "в", "во", "на", "у", "с", "со", "по", "а", "но", "или",
            "лет", "год", "года", "день", "дня", "дней", "час", "часа",
            "есть", "нет", "был", "была", "было", "стало", "затем"
        ));
        Set<String> tokens = new LinkedHashSet<>();
        for (String token : normalize(value).split("\\s+")) {
            if (token.length() >= 2 && !stop.contains(token)) tokens.add(token);
        }
        return new ArrayList<>(tokens);
    }

    private String normalize(String value) {
        return Normalizer.normalize(value == null ? "" : value, Normalizer.Form.NFKC)
            .toLowerCase(new Locale("ru"))
            .replace('ё', 'е')
            .replaceAll("[^\\p{L}\\p{N}%]+", " ")
            .trim()
            .replaceAll("\\s+", " ");
    }

    private Button example(String title, String value) {
        Button button = button(title);
        button.setTextSize(12);
        button.setOnClickListener(view -> search(value));
        LinearLayout.LayoutParams params = wrapWrap();
        params.rightMargin = dp(7);
        button.setLayoutParams(params);
        return button;
    }

    private Button button(String value) {
        Button button = new Button(this);
        button.setText(value);
        button.setTextColor(Color.WHITE);
        button.setTextSize(13);
        button.setAllCaps(false);
        button.setPadding(dp(13), dp(8), dp(13), dp(8));
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setBackground(panel(ACCENT, ACCENT, 9));
        return button;
    }

    private TextView chip(String value, int background) {
        TextView chip = text(value, 10, Color.WHITE);
        chip.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        chip.setPadding(dp(8), dp(5), dp(8), dp(5));
        chip.setBackground(panel(background, background, 8));
        LinearLayout.LayoutParams params = wrapWrap();
        params.rightMargin = dp(6);
        params.bottomMargin = dp(6);
        chip.setLayoutParams(params);
        return chip;
    }

    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }

    private LinearLayout column() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        return layout;
    }

    private LinearLayout row() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.HORIZONTAL);
        layout.setGravity(Gravity.START);
        return layout;
    }

    private GradientDrawable panel(int fill, int stroke, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(radius));
        drawable.setStroke(dp(1), stroke);
        return drawable;
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
    }

    private LinearLayout.LayoutParams wrapWrap() {
        return new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void hideKeyboard() {
        View current = getCurrentFocus();
        if (current == null) return;
        InputMethodManager manager =
            (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        manager.hideSoftInputFromWindow(current.getWindowToken(), 0);
        current.clearFocus();
    }

    private static final class Card {
        final String id;
        final String title;
        final String section;
        final String body;
        final String keywords;
        final int priority;
        int score;

        Card(String id, String title, String section, String body, String keywords, int priority) {
            this.id = id;
            this.title = title;
            this.section = section;
            this.body = body;
            this.keywords = keywords;
            this.priority = priority;
        }
    }
}
